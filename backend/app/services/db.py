import os
import ssl
import certifi
from typing import Optional, List
import asyncpg

_POOL: Optional[asyncpg.Pool] = None

DB_URL = os.getenv("SUPABASE_DB_URL")
if not DB_URL:
    raise RuntimeError("Missing SUPABASE_DB_URL environment variable")

def _build_ssl_ctx() -> ssl.SSLContext:
    # Use certifi's CA bundle to avoid "self-signed in chain" issues
    ctx = ssl.create_default_context(cafile=certifi.where())
    ctx.check_hostname = True
    ctx.verify_mode = ssl.CERT_REQUIRED
    return ctx

_SSL_CTX = _build_ssl_ctx()

async def init_pool(min_size: int = 1, max_size: int = 10) -> asyncpg.Pool:
    global _POOL
    if _POOL is None:
        _POOL = await asyncpg.create_pool(
            dsn=DB_URL,                 # e.g. ...?sslmode=require
            min_size=min_size,
            max_size=max_size,
            ssl=_SSL_CTX,               # <- important
            command_timeout=60,
        )
    return _POOL

async def close_pool():
    global _POOL
    if _POOL is not None:
        await _POOL.close()
        _POOL = None

async def fetch(query: str, *args) -> List[asyncpg.Record]:
    if _POOL is None:
        await init_pool()
    async with _POOL.acquire() as conn:
        return await conn.fetch(query, *args)

async def fetchrow(query: str, *args):
    rows = await fetch(query, *args)
    return rows[0] if rows else None
