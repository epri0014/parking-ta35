from dateutil import parser
from datetime import datetime
from zoneinfo import ZoneInfo

MEL_TZ = ZoneInfo("Australia/Melbourne")

def parse_to_melbourne(dt_iso: str) -> datetime:
    """
    Parse ISO-8601 and convert to Australia/Melbourne timezone-aware datetime.
    If the input has no tzinfo, assume Melbourne local.
    """
    dt = parser.isoparse(dt_iso)
    if dt.tzinfo is None:
        dt = MEL_TZ.localize(dt)
    else:
        dt = dt.astimezone(MEL_TZ)
    return dt

def derive_time_features(dt: datetime):
    # 0=Monday like your training
    return dt.hour, dt.weekday(), dt.month
