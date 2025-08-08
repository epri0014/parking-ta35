import httpx
from app.services.join import fetch_descriptions_bulk, fetch_restrictions_bulk

BASE_SENSOR_URL = "https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/on-street-parking-bay-sensors/records"

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
