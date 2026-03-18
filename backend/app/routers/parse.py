"""API Router for TTP parsing operations."""
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from typing import Optional
from pydantic import BaseModel

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
