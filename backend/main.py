from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes import generate, health

app = FastAPI(title="Math Homework Generator API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten to GitHub Pages URL in production
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(generate.router, prefix="/api")
