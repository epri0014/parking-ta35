import os
import psycopg2
from psycopg2.extras import RealDictCursor

DB_URL = os.getenv("SUPABASE_DB_URL")

def get_connection():
    if not DB_URL:
        raise RuntimeError(
            "SUPABASE_DB_URL is not set. Add it to .env (include ?sslmode=require)."
        )
    # If user forgot sslmode, add it
    dsn = DB_URL if "sslmode=" in DB_URL else (DB_URL + ("&" if "?" in DB_URL else "?") + "sslmode=require")
    return psycopg2.connect(dsn, cursor_factory=RealDictCursor)

def fetch_states():
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT state_id, state_name FROM states ORDER BY state_name;")
        return cur.fetchall()

def fetch_population(state_id: int):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT year, population
            FROM population_estimates
            WHERE state_id = %s
            ORDER BY year;
        """, (state_id,))
        return cur.fetchall()

def fetch_motor_vehicles(state_id: int):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT year, total
            FROM motor_vehicle_totals
            WHERE state_id = %s
            ORDER BY year;
        """, (state_id,))
        return cur.fetchall()
