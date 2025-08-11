from fastapi import APIRouter, Query, HTTPException
from app.services import nominatim, melbourne_data
from app.services.predict import predict_for_candidates
from app.schemas.prediction import PredictionRequest, PredictionResponse, PredictionResult
from app.utils.time import parse_to_melbourne, derive_time_features
from datetime import datetime

router = APIRouter()

@router.get("/search")
async def search_location(q: str = Query(...)):
    return await nominatim.autocomplete(q)

@router.get("/parking/realtime")
async def get_parking(lat: float, lon: float):
    return await melbourne_data.query_realtime_bays(lat, lon)

@router.get("/parking/nearby")
async def get_nearby_candidates(lat: float, lon: float):
    """
    Step 3a: Returns 20 nearby candidates (coords, description, zone_number, restrictions)
    """
    return await melbourne_data.query_nearby_for_prediction(lat, lon)

@router.post("/parking/predict", response_model=PredictionResponse)
async def predict_parking(body: PredictionRequest):
    """
    Step 3b: Given lat/lon + future datetime, return predictions for nearby candidates
    """
    dt = parse_to_melbourne(body.datetime_iso)
    now_mel = parse_to_melbourne(datetime.now().isoformat())

    if dt <= now_mel:
        raise HTTPException(status_code=400, detail="datetime_iso must be in the future (Australia/Melbourne)")

    hour, weekday, month = derive_time_features(dt)

    # Step 3a: derive candidates server-side
    candidates = await melbourne_data.query_nearby_for_prediction(body.lat, body.lon)
    if not candidates:
        return PredictionResponse(datetime_iso=dt.isoformat(), model_info={"name": "RandomForestClassifier", "accuracy_estimate": 0.693}, results=[])

    results = predict_for_candidates(candidates, hour, weekday, month, threshold=0.5)

    return PredictionResponse(
        datetime_iso=dt.isoformat(),
        model_info={"name": "RandomForestClassifier", "accuracy_estimate": 0.693},
        results=[PredictionResult(**r) for r in results]
    )