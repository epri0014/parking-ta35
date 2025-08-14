# app/services/db.py
import os
from typing import Any, List, Optional, Sequence, Mapping
from sqlalchemy import create_engine, text, bindparam
from sqlalchemy.engine import Engine, Row
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode

_ENGINE: Optional[Engine] = None

def _ensure_sslmode(dsn: str) -> str:
    """Guarantee sslmode=require is present for Supabase."""
    url = urlparse(dsn)
    query = dict(parse_qsl(url.query, keep_blank_values=True))
    query.setdefault("sslmode", "require")
    return urlunparse(url._replace(query=urlencode(query)))

def get_engine() -> Engine:
    global _ENGINE
    if _ENGINE is None:
        db_url = os.getenv("SUPABASE_DB_URL")
        if not db_url:
            raise RuntimeError("Missing SUPABASE_DB_URL")
        db_url = _ensure_sslmode(db_url)
        _ENGINE = create_engine(
            db_url,
            pool_pre_ping=True,
            pool_size=5,
            max_overflow=5,
            future=True,
        )
    return _ENGINE

def fetch_all(sql: str, params: Optional[Mapping[str, Any]] = None) -> List[Row]:
    eng = get_engine()
    with eng.connect() as conn:
        return list(conn.execute(text(sql), params or {}))

def fetch_all_expanding(sql: str, name: str, seq: Sequence[Any], other_params: Optional[Mapping[str, Any]] = None) -> List[Row]:
    """
    Helper for IN (:name) with expanding params.
    Example:
      sql = "SELECT * FROM t WHERE col IN :ids"
      rows = fetch_all_expanding(sql, "ids", ["a","b"])
    """
    eng = get_engine()
    stmt = text(sql).bindparams(bindparam(name, expanding=True))
    with eng.connect() as conn:
        return list(conn.execute(stmt, {**(other_params or {}), name: list(seq)}))
