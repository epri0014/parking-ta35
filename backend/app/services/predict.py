import os
import joblib
from functools import lru_cache
import numpy as np
from typing import List, Dict, Any

DEFAULT_MODEL_PATH = os.getenv("MODEL_PATH", "app/models/best_rf_model.pkl")

@lru_cache(maxsize=1)
def get_model():
    if not os.path.isfile(DEFAULT_MODEL_PATH):
        raise FileNotFoundError(f"Model file not found at {DEFAULT_MODEL_PATH}")
    return joblib.load(DEFAULT_MODEL_PATH)

def build_feature_rows(candidates: List[Dict[str, Any]], hour: int, weekday: int, month: int):
    """
    Build X matrix in the order expected by your RF:
    ['latitude','longitude','hour','weekday','month','Zone_Number']
    """
    rows = []
    kept = []
    for c in candidates:
        lat = c.get("latitude")
        lon = c.get("longitude")
        zone = c.get("zone_number")
        if lat is None or lon is None or zone is None:
            # skip rows without essential fields
            continue
        rows.append([lat, lon, hour, weekday, month, int(zone)])
        kept.append(c)
    if not rows:
        return np.empty((0, 6)), []
    return np.array(rows, dtype=float), kept

def predict_for_candidates(candidates: List[Dict[str, Any]], hour: int, weekday: int, month: int, threshold: float = 0.5):
    model = get_model()
    X, kept = build_feature_rows(candidates, hour, weekday, month)
    if X.shape[0] == 0:
        return []

    proba = model.predict_proba(X)[:, 1]  # probability of class 1 = Occupied
    results = []
    for cand, p in zip(kept, proba):
        status = "Occupied" if p >= threshold else "Available"
        conf = p if p >= 0.5 else (1.0 - p)
        results.append({
            "latitude": cand["latitude"],
            "longitude": cand["longitude"],
            "zone_number": cand.get("zone_number"),
            "description": cand.get("description"),
            "restrictions": cand.get("restrictions", []),
            "proba_occupied": round(float(p), 4),
            "predicted_status": status,
            "confidence": round(float(conf), 4),
        })
    return results
