import httpx

async def autocomplete(query: str):
    url = "https://nominatim.openstreetmap.org/search"
    params = {
        "format": "json", 
        "q": query, 
        "limit": 5,
        "viewbox": "144.4249,-38.2307,145.7021,-37.5697",
        "bounded": 1
        }
    headers = {"User-Agent": "parkingfinder"}

    async with httpx.AsyncClient() as client:
        resp = await client.get(url, params=params, headers=headers)
        data = resp.json()

    return [{"name": d["display_name"], "lat": d["lat"], "lon": d["lon"]} for d in data]
