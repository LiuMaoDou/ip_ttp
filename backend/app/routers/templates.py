"""API router for saved template CRUD operations."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Response, status
from pydantic import BaseModel, Field

from ..services.template_service import TemplateService


router = APIRouter(prefix="/api/templates", tags=["templates"])


class TemplatePayload(BaseModel):
    """Base payload for saved templates."""

    name: str
    description: str = ""
    vendor: str = "Unassigned"
    category_path: list[str] = Field(default_factory=list)
    sample_text: str
    variables: list[dict[str, Any]] = Field(default_factory=list)
    groups: list[dict[str, Any]] = Field(default_factory=list)
    generated_template: str


class TemplateResponse(TemplatePayload):
    """Saved template response model."""

    id: str
    created_at: int
    updated_at: int


class TemplatesResponse(BaseModel):
    """Saved templates list response model."""

    templates: list[TemplateResponse]


@router.get("", response_model=TemplatesResponse)
async def list_templates():
    """Return all saved templates."""
    templates = TemplateService.list_templates()
    return TemplatesResponse(templates=[TemplateResponse(**template) for template in templates])


@router.post("", response_model=TemplateResponse, status_code=status.HTTP_201_CREATED)
async def create_template(payload: TemplatePayload):
    """Create a new saved template."""
    template = TemplateService.create_template(**payload.model_dump())
    return TemplateResponse(**template)


@router.put("/{template_id}", response_model=TemplateResponse)
async def update_template(template_id: str, payload: TemplatePayload):
    """Update an existing saved template."""
    template = TemplateService.update_template(template_id=template_id, **payload.model_dump())
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    return TemplateResponse(**template)


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(template_id: str):
    """Delete a saved template."""
    deleted = TemplateService.delete_template(template_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
