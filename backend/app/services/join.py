BASE_DESC_URL = "https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/on-street-parking-bays/records"
BASE_RESTR_URL = "https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/sign-plates-located-in-each-parking-zone/records"
BASE_SEGMENT_ZONES_URL = "https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/parking-zones-linked-to-street-segments/records"

async def fetch_descriptions_bulk(kerbside_ids, client):
    if not kerbside_ids:
        return {}

    query = "kerbsideid IN (" + ",".join(f"'{k}'" for k in kerbside_ids) + ")"
    params = {"where": query, "limit": len(kerbside_ids)}

    resp = await client.get(BASE_DESC_URL, params=params)
    records = resp.json().get("results", [])

    return {
        int(rec["kerbsideid"]): rec.get("roadsegmentdescription", "No description")
        for rec in records
    }

async def fetch_restrictions_bulk(zone_numbers, client):
    if not zone_numbers:
        return {}

    query = "parkingzone IN (" + ",".join(str(z) for z in zone_numbers) + ")"
    params = {"where": query, "limit": len(zone_numbers) * 5}

    resp = await client.get(BASE_RESTR_URL, params=params)
    records = resp.json().get("results", [])

    zone_map = {}
    for rec in records:
        zid = rec.get("parkingzone")
        if zid is not None:
            zone_map.setdefault(zid, []).append(rec)

    return zone_map

async def fetch_zones_for_segments_bulk(segment_ids, client):
    """
    Map road segment IDs -> parking zones (Zone_Number).
    Returns dict[int, list[int]]
    """
    if not segment_ids:
        return {}
    # IN (...) with numeric IDs
    ids_expr = ",".join(str(s) for s in set(segment_ids))
    query = f"segment_id IN ({ids_expr})"
    params = {"where": query, "limit": len(segment_ids) * 3}
    resp = await client.get(BASE_SEGMENT_ZONES_URL, params=params)
    records = resp.json().get("results", [])
    seg_to_zones = {}
    for rec in records:
        seg_id = rec.get("segment_id")
        zone = rec.get("parkingzone")
        if seg_id is not None and zone is not None:
            seg_to_zones.setdefault(int(seg_id), []).append(int(zone))
    return seg_to_zones