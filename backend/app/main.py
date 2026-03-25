"""FastAPI backend for TTP Web UI."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import generation, parse, template_library, templates
from .services.generation_service import GenerationTemplateService
from .services.parse_batch_service import ParseBatchService
from .services.template_service import TemplateService

app = FastAPI(
    title="mini-IPMaster API",
    description="Backend API for mini-IPMaster",
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
app.include_router(templates.router)
app.include_router(generation.router)
app.include_router(template_library.router)


@app.on_event("startup")
async def initialize_template_storage():
    """Ensure template storage is ready before serving requests."""
    TemplateService.initialize()
    GenerationTemplateService.initialize()
    ParseBatchService.initialize()


@app.get("/")
async def root():
    """Root endpoint - API info."""
    return {
        "name": "mini-IPMaster API",
        "version": "1.0.0",
        "docs": "/docs"
    }


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "healthy"}
