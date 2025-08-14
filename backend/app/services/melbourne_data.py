import httpx
from typing import List, Dict, Any
from starlette.concurrency import run_in_threadpool
from app.services.db import fetch_all, fetch_all_expanding

BASE_SENSOR_URL = "https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/on-street-parking-bay-sensors/records"

# ---------- helpers to read from DB views (sync), wrapped via threadpool ----------

def _db_fetch_bays_by_kerbside_ids(kerbside_ids: List[str]) -> Dict[str, Dict[str, Any]]:
    if not kerbside_ids:
        return {}
    rows = fetch_all_expanding(
        """
        SELECT DISTINCT ON (kerbside_id)
            kerbside_id,
            bay_id,
            road_segment_id,
            road_segment_description,
            ST_Y(geom)::float AS lat,
            ST_X(geom)::float AS lon,
            parking_zone,
            on_street, street_from, street_to,
            restrictions_json
        FROM v_bays_enriched_json
        WHERE kerbside_id IN :ids
        ORDER BY kerbside_id, parking_zone ASC NULLS LAST;
        """,
        "ids",
        kerbside_ids,
    )
    out: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        m = dict(r._mapping)
        out[str(m["kerbside_id"])] = m
    return out

def _db_fetch_nearby_bays(lat: float, lon: float, limit: int = 20, radius_m: int = 1000) -> List[Dict[str, Any]]:
    rows = fetch_all(
        """
        SELECT
          bay_id,
          kerbside_id,
          parking_zone,
          road_segment_description,
          ST_Y(geom)::float AS latitude,
          ST_X(geom)::float AS longitude,
          restrictions_json
        FROM v_bays_enriched_json
        WHERE ST_DWithin(
            geom::geography,
            ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography,
            :radius
        )
        ORDER BY geom <-> ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)
        LIMIT :limit;
        """,
        {"lon": float(lon), "lat": float(lat), "radius": int(radius_m), "limit": int(limit)},
    )
    return [dict(r._mapping) for r in rows]

# ---------- public API + DB enrichment ----------

async def query_realtime_bays(lat: float, lon: float) -> List[Dict[str, Any]]:
    """
    Keep sensor status from public API (fresh), enrich geometry/desc/rules from DB.
    """
    where = (
        f'status_description="Unoccupied" AND '
        f'within_distance(location, geom\'POINT({lon} {lat})\', 1000m) AND '
        f'lastupdated>now(minutes=-1)'
    )
    params = {
        "limit": 20,
        "order_by": f'distance(location, geom\'POINT({lon} {lat})\')',
        "where": where
    }

    async with httpx.AsyncClient(timeout=20.0) as client:
        res = await client.get(BASE_SENSOR_URL, params=params)
        res.raise_for_status()
        bays = res.json().get("results", [])
        if not bays:
            return []

    kerbside_ids = [str(b["kerbsideid"]) for b in bays if b.get("kerbsideid") is not None]

    # Run blocking DB call in a thread
    db_map = await run_in_threadpool(_db_fetch_bays_by_kerbside_ids, kerbside_ids)

    enriched: List[Dict[str, Any]] = []
    for b in bays:
        kid = str(b.get("kerbsideid"))
        live = {
            "kerbsideid": kid,
            "zone_number": b.get("zone_number"),
            "lat": b["location"]["lat"],
            "lon": b["location"]["lon"],
            "lastupdated": b.get("lastupdated"),
            "status_timestamp": b.get("status_timestamp"),
            "status_description": b.get("status_description"),
        }
        meta = db_map.get(kid)
        if meta:
            enriched.append({
                **live,
                "description": meta.get("road_segment_description", "No description"),
                "restrictions": meta.get("restrictions_json", []) or [],
            })
        else:
            enriched.append({**live, "description": "No description", "restrictions": []})
    return enriched

async def query_nearby_for_prediction(lat: float, lon: float) -> List[Dict[str, Any]]:
    """
    Only DB (no public API): nearest candidates with geometry/description/zone/restrictions.
    """
    rows = await run_in_threadpool(_db_fetch_nearby_bays, lat, lon, 20, 1000)
    out: List[Dict[str, Any]] = []
    for r in rows:
        out.append({
            "latitude": r["latitude"],
            "longitude": r["longitude"],
            "zone_number": r.get("parking_zone"),
            "description": r.get("road_segment_description") or "No description",
            "restrictions": r.get("restrictions_json", []) or [],
        })
    return out
