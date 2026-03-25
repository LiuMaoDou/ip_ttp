"""API Router for TTP parsing operations."""
import json
from typing import Any, Optional

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..services.parse_batch_service import ParseBatchService
from ..services.ttp_service import TTPService

router = APIRouter(prefix="/api", tags=["parse"])


class ParseRequest(BaseModel):
    """Request model for parsing."""
    data: str
    template: str
    name: Optional[str] = None  # Optional name to replace template group name


class ParseResponse(BaseModel):
    """Response model for parsing."""
    success: bool
    result: Optional[list | dict] = None
    csv_result: Optional[str] = None
    checkup_csv_result: Optional[str] = None
    error: Optional[str] = None
    error_type: Optional[str] = None


class PatternsResponse(BaseModel):
    """Response model for patterns list."""
    patterns: dict[str, dict[str, str]]


class BatchTemplatePayload(BaseModel):
    """A single template entry for batch parsing."""

    id: str
    name: str
    template: str


class BatchParseJobResponse(BaseModel):
    """Batch parse job status response."""

    id: str
    status: str
    phase_message: str
    created_at: int
    updated_at: int
    started_at: int | None = None
    completed_at: int | None = None
    template_count: int
    upload_count: int
    scanned_uploads: int
    total_uploads: int
    processed_archive_entries: int
    total_archive_entries: int
    uploads: list[dict[str, Any]]
    discovered_file_count: int
    skipped_file_count: int
    total_tasks: int
    completed_tasks: int
    success_count: int
    failure_count: int
    preview_results: list[dict[str, Any]]
    recent_error: dict[str, Any] | None = None
    artifact_urls: dict[str, str | None]


class BatchParseResultsPageResponse(BaseModel):
    """Paginated batch parse results response."""

    job_id: str
    offset: int
    limit: int
    total: int
    items: list[dict[str, Any]]


@router.post("/parse", response_model=ParseResponse)
async def parse_text(request: ParseRequest):
    """
    Parse text data using TTP template.

    Args:
        request: Contains data (text to parse), template (TTP template), and optional name

    Returns:
        Parse result or error
    """
    template = request.template
    # If name is provided, wrap the template with <group> tag
    if request.name:
        template = f'<group name="{request.name}">\n{template}\n</group>'

    result = TTPService.parse(
        data=request.data,
        template=template
    )
    return ParseResponse(**result)


@router.post("/parse/file", response_model=ParseResponse)
async def parse_file(
    file: UploadFile = File(...),
    template: str = Form(...)
):
    """
    Parse uploaded file using TTP template.

    Args:
        file: Uploaded text file
        template: TTP template string

    Returns:
        Parse result or error
    """
    try:
        content = await file.read()
        # Try to decode as UTF-8, fall back to latin-1
        try:
            data = content.decode("utf-8")
        except UnicodeDecodeError:
            data = content.decode("latin-1")

        result = TTPService.parse(data=data, template=template)
        return ParseResponse(**result)
    except Exception as e:
        return ParseResponse(
            success=False,
            error=str(e),
            error_type=type(e).__name__
        )


@router.get("/patterns", response_model=PatternsResponse)
async def get_patterns():
    """
    Get all available built-in patterns.

    Returns:
        Dictionary of pattern names with their regex and description
    """
    return PatternsResponse(patterns=TTPService.get_patterns())


@router.post("/parse/batch/jobs", response_model=BatchParseJobResponse)
async def create_batch_parse_job(
    templates_json: str = Form(...),
    files: list[UploadFile] = File(...),
):
    """Create a background batch parse job from uploaded files or archives."""
    try:
        templates_raw = json.loads(templates_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid templates_json payload") from exc

    if not isinstance(templates_raw, list):
        raise HTTPException(status_code=400, detail="templates_json must be a JSON array")

    try:
        templates = [BatchTemplatePayload.model_validate(item).model_dump() for item in templates_raw]
        job = await ParseBatchService.create_job(templates=templates, uploads=files)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return BatchParseJobResponse(**job)


@router.get("/parse/batch/jobs/{job_id}", response_model=BatchParseJobResponse)
async def get_batch_parse_job(job_id: str):
    """Return the latest status for a batch parse job."""
    try:
        job = ParseBatchService.get_job(job_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Batch parse job not found") from exc
    return BatchParseJobResponse(**job)


@router.post("/parse/batch/jobs/{job_id}/cancel", response_model=BatchParseJobResponse)
async def cancel_batch_parse_job(job_id: str):
    """Request cancellation for a batch parse job."""
    try:
        job = ParseBatchService.cancel_job(job_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Batch parse job not found") from exc
    return BatchParseJobResponse(**job)


@router.get("/parse/batch/jobs/{job_id}/results", response_model=BatchParseResultsPageResponse)
async def get_batch_parse_results(
    job_id: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    """Return a paginated slice of batch parse results."""
    try:
        page = ParseBatchService.get_results_page(job_id, offset=offset, limit=limit)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Batch parse job not found") from exc
    return BatchParseResultsPageResponse(**page)


@router.get("/parse/batch/jobs/{job_id}/artifacts/{artifact_name}")
async def download_batch_parse_artifact(job_id: str, artifact_name: str):
    """Download one of the generated batch parse artifacts."""
    try:
        artifact_path = ParseBatchService.get_artifact_path(job_id, artifact_name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Batch parse artifact not found") from exc

    media_type = "application/json"
    if artifact_path.suffix == ".jsonl":
        media_type = "application/x-ndjson"

    return FileResponse(
        artifact_path,
        media_type=media_type,
        filename=artifact_path.name,
    )
