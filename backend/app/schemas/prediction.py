from pydantic import BaseModel, Field, constr, confloat, validator
from typing import List, Optional
from datetime import datetime

class NearbyCandidate(BaseModel):
    latitude: confloat(ge=-90, le=90)
    longitude: confloat(ge=-180, le=180)
    zone_number: Optional[int] = Field(None, description="Parking zone (Zone_Number)")
    description: Optional[str] = "No description"
    restrictions: List[dict] = []

class PredictionRequest(BaseModel):
    lat: confloat(ge=-90, le=90)
    lon: confloat(ge=-180, le=180)
    datetime_iso: constr(strip_whitespace=True)

    @validator("datetime_iso")
    def must_parse_datetime(cls, v):
        # basic sanity check; parsing is done server-side with dateutil
        if "T" not in v:
            raise ValueError("datetime_iso must be ISO-8601")
        return v

class PredictionResult(BaseModel):
    latitude: float
    longitude: float
    zone_number: Optional[int]
    description: Optional[str]
    restrictions: List[dict] = []
    proba_occupied: float
    predicted_status: str
    confidence: float

class PredictionResponse(BaseModel):
    datetime_iso: str
    model_info: dict
    results: List[PredictionResult]
