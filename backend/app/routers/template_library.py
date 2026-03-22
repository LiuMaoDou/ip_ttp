"""API router for shared template vendors and per-kind categories."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from ..services.generation_service import GenerationTemplateService
from ..services.template_directory_service import (
    TEMPLATE_KIND_GENERATION,
    TEMPLATE_KIND_PARSE,
    DirectoryConflictError,
    DirectoryNotFoundError,
    TemplateDirectoryService,
)
from ..services.template_service import TemplateService


TemplateKind = Literal["parse", "generation"]

router = APIRouter(prefix="/api/template-library", tags=["template-library"])


class VendorPayload(BaseModel):
    """Create or rename a vendor."""

    name: str


class VendorResponse(BaseModel):
    """Vendor response model."""

    name: str
    created_at: int
    updated_at: int


class VendorsResponse(BaseModel):
    """Vendor list response."""

    vendors: list[VendorResponse]


class CategoryPayload(BaseModel):
    """Create or update a category."""

    name: str
    vendor: str
    parent_id: str | None = None


class CategoryResponse(BaseModel):
    """Category response model."""

    id: str
    vendor: str
    name: str
    parent_id: str | None = None
    path: list[str] = Field(default_factory=list)
    created_at: int
    updated_at: int


class CategoriesResponse(BaseModel):
    """Category list response."""

    categories: list[CategoryResponse]


def _initialize_services() -> None:
    TemplateService.initialize()
    GenerationTemplateService.initialize()


def _to_template_kind(template_kind: TemplateKind) -> str:
    return TEMPLATE_KIND_PARSE if template_kind == "parse" else TEMPLATE_KIND_GENERATION


def _handle_directory_error(exc: ValueError) -> None:
    if isinstance(exc, DirectoryNotFoundError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    if isinstance(exc, DirectoryConflictError):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/vendors", response_model=VendorsResponse)
async def list_vendors():
    """Return shared vendors."""
    _initialize_services()
    connection = TemplateService._connect()  # pylint: disable=protected-access
    try:
        vendors = TemplateDirectoryService.list_vendors(connection)
    finally:
        connection.close()
    return VendorsResponse(vendors=[VendorResponse(**vendor) for vendor in vendors])


@router.post("/vendors", response_model=VendorResponse, status_code=status.HTTP_201_CREATED)
async def create_vendor(payload: VendorPayload):
    """Create a shared vendor."""
    _initialize_services()
    connection = TemplateService._connect()  # pylint: disable=protected-access
    try:
        vendor = TemplateDirectoryService.create_vendor(connection, payload.name)
        connection.commit()
    except ValueError as exc:
        connection.rollback()
        _handle_directory_error(exc)
    finally:
        connection.close()
    return VendorResponse(**vendor)


@router.put("/vendors/{vendor_name}", response_model=VendorResponse)
async def rename_vendor(vendor_name: str, payload: VendorPayload):
    """Rename a shared vendor."""
    _initialize_services()
    connection = TemplateService._connect()  # pylint: disable=protected-access
    try:
        vendor = TemplateDirectoryService.rename_vendor(connection, vendor_name, payload.name)
        connection.commit()
    except ValueError as exc:
        connection.rollback()
        _handle_directory_error(exc)
    finally:
        connection.close()
    return VendorResponse(**vendor)


@router.delete("/vendors/{vendor_name}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_vendor(vendor_name: str):
    """Delete an empty vendor."""
    _initialize_services()
    connection = TemplateService._connect()  # pylint: disable=protected-access
    try:
        TemplateDirectoryService.delete_vendor(connection, vendor_name)
        connection.commit()
    except ValueError as exc:
        connection.rollback()
        _handle_directory_error(exc)
    finally:
        connection.close()
    return None


@router.get("/{template_kind}/categories", response_model=CategoriesResponse)
async def list_categories(template_kind: TemplateKind):
    """Return categories for a template kind."""
    _initialize_services()
    connection = TemplateService._connect()  # pylint: disable=protected-access
    try:
        categories = TemplateDirectoryService.list_categories(connection, _to_template_kind(template_kind))
    finally:
        connection.close()
    return CategoriesResponse(categories=[CategoryResponse(**category) for category in categories])


@router.post("/{template_kind}/categories", response_model=CategoryResponse, status_code=status.HTTP_201_CREATED)
async def create_category(template_kind: TemplateKind, payload: CategoryPayload):
    """Create a category for a template kind."""
    _initialize_services()
    connection = TemplateService._connect()  # pylint: disable=protected-access
    try:
        category = TemplateDirectoryService.create_category(
            connection,
            _to_template_kind(template_kind),
            payload.vendor,
            payload.name,
            parent_id=payload.parent_id,
        )
        connection.commit()
    except ValueError as exc:
        connection.rollback()
        _handle_directory_error(exc)
    finally:
        connection.close()
    return CategoryResponse(**category)


@router.put("/{template_kind}/categories/{category_id}", response_model=CategoryResponse)
async def update_category(template_kind: TemplateKind, category_id: str, payload: CategoryPayload):
    """Rename or move a category."""
    _initialize_services()
    connection = TemplateService._connect()  # pylint: disable=protected-access
    try:
        category = TemplateDirectoryService.update_category(
            connection,
            _to_template_kind(template_kind),
            category_id,
            name=payload.name,
            vendor=payload.vendor,
            parent_id=payload.parent_id,
        )
        connection.commit()
    except ValueError as exc:
        connection.rollback()
        _handle_directory_error(exc)
    finally:
        connection.close()
    return CategoryResponse(**category)


@router.delete("/{template_kind}/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(template_kind: TemplateKind, category_id: str):
    """Delete an empty category."""
    _initialize_services()
    connection = TemplateService._connect()  # pylint: disable=protected-access
    try:
        TemplateDirectoryService.delete_category(connection, _to_template_kind(template_kind), category_id)
        connection.commit()
    except ValueError as exc:
        connection.rollback()
        _handle_directory_error(exc)
    finally:
        connection.close()
    return None
