"""FastAPI backend for TTP Web UI."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import parse

app = FastAPI(
    title="TTP Web API",
    description="Backend API for TTP (Template Text Parser) Web UI",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Configure CORS for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # Vite dev server
        "http://localhost:3000",  # Alternative dev port
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(parse.router)


@app.get("/")
async def root():
    """Root endpoint - API info."""
    return {
        "name": "TTP Web API",
        "version": "1.0.0",
        "docs": "/docs"
    }


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "healthy"}
