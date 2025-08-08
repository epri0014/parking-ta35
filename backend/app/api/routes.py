from fastapi import APIRouter, Query
from app.services import nominatim, melbourne_data

router = APIRouter()

@router.get("/search")
async def search_location(q: str = Query(...)):
    return await nominatim.autocomplete(q)

@router.get("/parking/realtime")
async def get_parking(lat: float, lon: float):
    return await melbourne_data.query_realtime_bays(lat, lon)
