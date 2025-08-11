import httpx
from app.services.join import (
    fetch_descriptions_bulk,
    fetch_restrictions_bulk,
    fetch_zones_for_segments_bulk,
)

BASE_SENSOR_URL = "https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/on-street-parking-bay-sensors/records"
BASE_BAYS_URL = "https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/on-street-parking-bays/records"

async def query_realtime_bays(lat: float, lon: float):
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

    async with httpx.AsyncClient() as client:
        # 1. Fetch nearby bay sensors
        res = await client.get(BASE_SENSOR_URL, params=params)
        bays = res.json().get("results", [])
        if not bays:
            return []

        # 2. Collect unique kerbsideids and zone_numbers
        kerbside_ids = [b["kerbsideid"] for b in bays]
        zone_numbers = list(set(b["zone_number"] for b in bays if b.get("zone_number") is not None))

        # 3. Batch fetch descriptions and restrictions
        desc_map = await fetch_descriptions_bulk(kerbside_ids, client)
        restr_map = await fetch_restrictions_bulk(zone_numbers, client)

        # 4. Enrich bays with info
        enriched = []
        for b in bays:
            kid = b["kerbsideid"]
            zid = b.get("zone_number")
            enriched.append({
                "kerbsideid": kid,
                "zone_number": zid,
                "lat": b["location"]["lat"],
                "lon": b["location"]["lon"],
                "lastupdated": b["lastupdated"],
                "description": desc_map.get(kid, "No description"),
                "restrictions": restr_map.get(zid, []) if zid is not None else []
            })

        return enriched

async def query_nearby_for_prediction(lat: float, lon: float):
    """
    Step for Prediction:
    1) nearby street segments from on-street-parking-bays (20 closest)
    2) bulk map segment_id -> parking zones
    3) bulk map zones -> restrictions
    Returns 20 candidates with coordinate + description + zone + restrictions
    """
    params = {
        "limit": 20,
        "order_by": f'distance(location, geom\'POINT({lon} {lat})\')',
        "where": f"within_distance(location, geom'POINT({lon} {lat})', 1000m)"
    }
    async with httpx.AsyncClient() as client:
        res = await client.get(BASE_BAYS_URL, params=params)
        recs = res.json().get("results", [])
        if not recs:
            return []

        # Collect roadsegmentid & zones
        segments = []
        for r in recs:
            seg_id = r.get("roadsegmentid")
            if seg_id is not None:
                segments.append(int(seg_id))

        seg_to_zones = await fetch_zones_for_segments_bulk(segments, client)

        # Collect unique zones for restriction fetch
        zones = set()
        for seg in segments:
            for z in seg_to_zones.get(seg, []):
                zones.add(z)
        restr_map = await fetch_restrictions_bulk(list(zones), client)

        # Build candidates (pick first zone if multiple; you can later expand)
        candidates = []
        for r in recs:
            seg_id = r.get("roadsegmentid")
            loc = r.get("location", {})
            lat_r = loc.get("lat") or r.get("latitude")
            lon_r = loc.get("lon") or r.get("longitude")
            desc = r.get("roadsegmentdescription") or "No description"

            zone_list = seg_to_zones.get(int(seg_id), []) if seg_id is not None else []
            zone = zone_list[0] if zone_list else None
            restrictions = restr_map.get(zone, []) if zone is not None else []

            candidates.append({
                "latitude": lat_r,
                "longitude": lon_r,
                "zone_number": zone,
                "description": desc,
                "restrictions": restrictions
            })
        return candidates