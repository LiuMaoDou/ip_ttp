"""API router for config generation template CRUD and batch rendering."""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, Field, ValidationError

from ..services.generation_service import ConfigGenerationService, GenerationTemplateService

router = APIRouter(prefix="/api/generation", tags=["generation"])


class GenerationTemplatePayload(BaseModel):
    """Base payload for saved generation templates."""

    name: str
    description: str = ""
    template_text: str
    source_templates: list[dict[str, Any]] = Field(default_factory=list)
    bindings: list[dict[str, Any]] = Field(default_factory=list)


class GenerationTemplateResponse(GenerationTemplatePayload):
    """Saved generation template response model."""

    id: str
    created_at: int
    updated_at: int


class GenerationTemplatesResponse(BaseModel):
    """Saved generation templates list response model."""

    templates: list[GenerationTemplateResponse]


class RenderedGenerationResult(BaseModel):
    """Result for a single rendered JSON input file."""

    file_name: str
    success: bool
    generated_text: str | None = None
    error: str | None = None
    error_type: str | None = None


class RenderGenerationResponse(BaseModel):
    """Batch config generation response model."""

    results: list[RenderedGenerationResult]


@router.get("/templates", response_model=GenerationTemplatesResponse)
async def list_generation_templates():
    """Return all saved generation templates."""
    templates = GenerationTemplateService.list_templates()
    return GenerationTemplatesResponse(
        templates=[GenerationTemplateResponse(**template) for template in templates]
    )


@router.post("/templates", response_model=GenerationTemplateResponse, status_code=status.HTTP_201_CREATED)
async def create_generation_template(payload: GenerationTemplatePayload):
    """Create a new saved generation template."""
    template = GenerationTemplateService.create_template(**payload.model_dump())
    return GenerationTemplateResponse(**template)


@router.put("/templates/{template_id}", response_model=GenerationTemplateResponse)
async def update_generation_template(template_id: str, payload: GenerationTemplatePayload):
    """Update an existing saved generation template."""
    template = GenerationTemplateService.update_template(template_id=template_id, **payload.model_dump())
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Generation template not found")
    return GenerationTemplateResponse(**template)


@router.delete("/templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_generation_template(template_id: str):
    """Delete a saved generation template."""
    deleted = GenerationTemplateService.delete_template(template_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Generation template not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/render", response_model=RenderGenerationResponse)
async def render_generation_files(
    generation_template_id: str | None = Form(None),
    generation_template: str | None = Form(None),
    files: list[UploadFile] = File(...),
):
    """Render a saved or draft generation template against uploaded JSON files."""
    if generation_template:
        try:
            generation_template_payload = GenerationTemplatePayload.model_validate_json(
                generation_template
            )
        except ValidationError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Invalid generation template payload",
            ) from exc
        generation_template_data = generation_template_payload.model_dump()
    elif generation_template_id:
        generation_template_data = GenerationTemplateService.get_template(
            generation_template_id
        )
        if generation_template_data is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Generation template not found",
            )
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="generation_template or generation_template_id is required",
        )

    uploaded_files: list[dict[str, Any]] = []
    for file in files:
        content = await file.read()
        try:
            decoded = content.decode("utf-8")
        except UnicodeDecodeError:
            decoded = content.decode("latin-1")

        try:
            payload = json.loads(decoded)
        except json.JSONDecodeError:
            uploaded_files.append(
                {
                    "file_name": file.filename or "uploaded.json",
                    "invalid_json": True,
                }
            )
            continue

        uploaded_files.append(
            {
                "file_name": file.filename or "uploaded.json",
                "payload": payload,
                "invalid_json": False,
            }
        )

    results: list[dict[str, Any]] = []
    valid_files = [item for item in uploaded_files if not item["invalid_json"]]

    if valid_files:
        results.extend(ConfigGenerationService.render_batch(generation_template_data, valid_files))

    for file in uploaded_files:
        if file["invalid_json"]:
            results.append(
                {
                    "file_name": file["file_name"],
                    "success": False,
                    "error": "Uploaded file is not valid JSON",
                    "error_type": "JSONDecodeError",
                }
            )

    return RenderGenerationResponse(results=[RenderedGenerationResult(**result) for result in results])
