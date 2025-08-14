import httpx
from typing import List, Dict, Any
from app.services.db import fetch

BASE_SENSOR_URL = "https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/on-street-parking-bay-sensors/records"

# ---------- helpers to read from DB views ----------

async def _fetch_bays_by_kerbside_ids(kerbside_ids: List[str]) -> Dict[str, Dict[str, Any]]:
    """
    Return one enriched row per kerbside_id (pick the first zone if multiple).
    You can choose to return all zones if you prefer (group by kerbside_id).
    """
    if not kerbside_ids:
        return {}
    # DISTINCT ON picks a single row per kerbside_id (first by parking_zone asc)
    q = """
        SELECT DISTINCT ON (kerbside_id)
            kerbside_id,
            bay_id,
            road_segment_id,
            road_segment_description,
            latitude, longitude,
            ST_Y(geom)::float AS lat,
            ST_X(geom)::float AS lon,
            parking_zone,
            on_street, street_from, street_to,
            restrictions_json
        FROM v_bays_enriched_json
        WHERE kerbside_id = ANY($1::text[])
        ORDER BY kerbside_id, parking_zone ASC NULLS LAST;
    """
    rows = await fetch(q, kerbside_ids)
    out: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        out[r["kerbside_id"]] = dict(r)
    return out

async def _fetch_nearby_bays_from_db(lat: float, lon: float, limit: int = 20, radius_m: int = 1000) -> List[Dict[str, Any]]:
    """
    Nearest enriched bays (with restrictions_json) using the view.
    This is used by the prediction pipeline.
    """
    q = """
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
            ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
            $3
        )
        ORDER BY geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
        LIMIT $4;
    """
    rows = await fetch(q, lon, lat, radius_m, limit)  # note lon, lat
    return [dict(r) for r in rows]

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

        # Enrich from DB by kerbside_id
        db_map = await _fetch_bays_by_kerbside_ids(kerbside_ids)

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
                # Fallback if DB has no row for this kerbside_id
                enriched.append({
                    **live,
                    "description": "No description",
                    "restrictions": []
                })
        return enriched

async def query_nearby_for_prediction(lat: float, lon: float) -> List[Dict[str, Any]]:
    """
    Only DB (no public API): nearest candidates with geometry/description/zone/restrictions.
    """
    rows = await _fetch_nearby_bays_from_db(lat, lon, limit=20, radius_m=1000)
    # Shape to your Prediction schema
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
