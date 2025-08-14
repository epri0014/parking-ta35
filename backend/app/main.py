from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes import router
from app.services.db import init_pool, close_pool

app = FastAPI()

@app.on_event("startup")
async def _startup():
    await init_pool()

@app.on_event("shutdown")
async def _shutdown():
    await close_pool()
    
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # frontend domain in prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")
