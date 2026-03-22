"""Shared vendor and category directory services for saved templates."""
from __future__ import annotations

import json
import sqlite3
import time
import uuid
from typing import Any


DEFAULT_VENDOR = "Unassigned"
TEMPLATE_KIND_PARSE = "parse"
TEMPLATE_KIND_GENERATION = "generation"

_CATEGORY_TABLES = {
    TEMPLATE_KIND_PARSE: "template_categories",
    TEMPLATE_KIND_GENERATION: "generation_categories",
}

_TEMPLATE_TABLES = {
    TEMPLATE_KIND_PARSE: "templates",
    TEMPLATE_KIND_GENERATION: "generation_templates",
}


def _current_timestamp() -> int:
    """Return the current timestamp in milliseconds."""
    return time.time_ns() // 1_000_000


class DirectoryConflictError(ValueError):
    """Raised when an operation violates a directory constraint."""


class DirectoryNotFoundError(ValueError):
    """Raised when an operation references a missing directory item."""


class TemplateDirectoryService:
    """Maintain shared vendors and per-template-type category trees."""

    @classmethod
    def initialize(cls, connection: sqlite3.Connection) -> None:
        """Ensure directory tables exist and the default vendor is present."""
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS template_vendors (
                name TEXT PRIMARY KEY,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
            """
        )

        for table_name in _CATEGORY_TABLES.values():
            connection.execute(
                f"""
                CREATE TABLE IF NOT EXISTS {table_name} (
                    id TEXT PRIMARY KEY,
                    vendor TEXT NOT NULL,
                    name TEXT NOT NULL,
                    parent_id TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                )
                """
            )
            connection.execute(
                f"CREATE INDEX IF NOT EXISTS idx_{table_name}_vendor_parent ON {table_name} (vendor, parent_id)"
            )

        cls.ensure_vendor(connection, DEFAULT_VENDOR)

    @staticmethod
    def _normalize_vendor(vendor: str | None) -> str:
        """Return a normalized vendor name."""
        normalized = (vendor or DEFAULT_VENDOR).strip()
        return normalized or DEFAULT_VENDOR

    @staticmethod
    def normalize_category_path(category_path: list[str] | None) -> list[str]:
        """Return a normalized category path."""
        if not category_path:
            return []
        return [segment.strip() for segment in category_path if isinstance(segment, str) and segment.strip()]

    @classmethod
    def _category_table(cls, template_kind: str) -> str:
        """Return the category table for a template kind."""
        table_name = _CATEGORY_TABLES.get(template_kind)
        if table_name is None:
            raise ValueError(f"Unsupported template kind: {template_kind}")
        return table_name

    @classmethod
    def _template_table(cls, template_kind: str) -> str:
        """Return the template table for a template kind."""
        table_name = _TEMPLATE_TABLES.get(template_kind)
        if table_name is None:
            raise ValueError(f"Unsupported template kind: {template_kind}")
        return table_name

    @classmethod
    def ensure_vendor(cls, connection: sqlite3.Connection, vendor: str | None) -> str:
        """Create the vendor if it does not already exist."""
        normalized_vendor = cls._normalize_vendor(vendor)
        row = connection.execute(
            "SELECT name FROM template_vendors WHERE name = ?",
            (normalized_vendor,),
        ).fetchone()
        if row is not None:
            return normalized_vendor

        timestamp = _current_timestamp()
        connection.execute(
            """
            INSERT INTO template_vendors (name, created_at, updated_at)
            VALUES (?, ?, ?)
            """,
            (normalized_vendor, timestamp, timestamp),
        )
        return normalized_vendor

    @classmethod
    def list_vendors(cls, connection: sqlite3.Connection) -> list[dict[str, Any]]:
        """Return all vendors."""
        rows = connection.execute(
            """
            SELECT name, created_at, updated_at
            FROM template_vendors
            ORDER BY CASE WHEN name = ? THEN 1 ELSE 0 END, name COLLATE NOCASE ASC
            """,
            (DEFAULT_VENDOR,),
        ).fetchall()
        return [
            {
                "name": row["name"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }
            for row in rows
        ]

    @classmethod
    def create_vendor(cls, connection: sqlite3.Connection, name: str) -> dict[str, Any]:
        """Create a new vendor."""
        vendor = cls._normalize_vendor(name)
        if connection.execute(
            "SELECT 1 FROM template_vendors WHERE name = ?",
            (vendor,),
        ).fetchone():
            raise DirectoryConflictError("Vendor already exists")

        timestamp = _current_timestamp()
        connection.execute(
            """
            INSERT INTO template_vendors (name, created_at, updated_at)
            VALUES (?, ?, ?)
            """,
            (vendor, timestamp, timestamp),
        )
        row = connection.execute(
            "SELECT name, created_at, updated_at FROM template_vendors WHERE name = ?",
            (vendor,),
        ).fetchone()
        return {
            "name": row["name"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    @classmethod
    def rename_vendor(
        cls,
        connection: sqlite3.Connection,
        current_name: str,
        new_name: str,
    ) -> dict[str, Any]:
        """Rename an existing vendor and update all linked records."""
        current_vendor = cls._normalize_vendor(current_name)
        next_vendor = cls._normalize_vendor(new_name)

        if not connection.execute(
            "SELECT 1 FROM template_vendors WHERE name = ?",
            (current_vendor,),
        ).fetchone():
            raise DirectoryNotFoundError("Vendor not found")

        if current_vendor != next_vendor and connection.execute(
            "SELECT 1 FROM template_vendors WHERE name = ?",
            (next_vendor,),
        ).fetchone():
            raise DirectoryConflictError("Vendor already exists")

        timestamp = _current_timestamp()
        connection.execute(
            """
            UPDATE template_vendors
            SET name = ?, updated_at = ?
            WHERE name = ?
            """,
            (next_vendor, timestamp, current_vendor),
        )

        for table_name in _CATEGORY_TABLES.values():
            connection.execute(
                f"UPDATE {table_name} SET vendor = ? WHERE vendor = ?",
                (next_vendor, current_vendor),
            )

        for template_kind in _TEMPLATE_TABLES:
            cls._rename_template_vendor_records(connection, template_kind, current_vendor, next_vendor)

        row = connection.execute(
            "SELECT name, created_at, updated_at FROM template_vendors WHERE name = ?",
            (next_vendor,),
        ).fetchone()
        return {
            "name": row["name"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    @classmethod
    def delete_vendor(cls, connection: sqlite3.Connection, vendor_name: str) -> None:
        """Delete an empty vendor."""
        vendor = cls._normalize_vendor(vendor_name)
        if vendor == DEFAULT_VENDOR:
            raise DirectoryConflictError("Default vendor cannot be deleted")

        if not connection.execute(
            "SELECT 1 FROM template_vendors WHERE name = ?",
            (vendor,),
        ).fetchone():
            raise DirectoryNotFoundError("Vendor not found")

        for table_name in _CATEGORY_TABLES.values():
            if connection.execute(
                f"SELECT 1 FROM {table_name} WHERE vendor = ? LIMIT 1",
                (vendor,),
            ).fetchone():
                raise DirectoryConflictError("Vendor still contains categories")

        for template_kind in _TEMPLATE_TABLES:
            template_table = cls._template_table(template_kind)
            if connection.execute(
                f"SELECT 1 FROM {template_table} WHERE vendor = ? LIMIT 1",
                (vendor,),
            ).fetchone():
                raise DirectoryConflictError("Vendor still contains templates")

        connection.execute(
            "DELETE FROM template_vendors WHERE name = ?",
            (vendor,),
        )

    @classmethod
    def list_categories(
        cls,
        connection: sqlite3.Connection,
        template_kind: str,
    ) -> list[dict[str, Any]]:
        """Return all categories for a template kind with resolved paths."""
        table_name = cls._category_table(template_kind)
        rows = connection.execute(
            f"""
            SELECT id, vendor, name, parent_id, created_at, updated_at
            FROM {table_name}
            ORDER BY vendor COLLATE NOCASE ASC, name COLLATE NOCASE ASC
            """
        ).fetchall()
        return cls._rows_to_categories(rows)

    @classmethod
    def create_category(
        cls,
        connection: sqlite3.Connection,
        template_kind: str,
        vendor: str,
        name: str,
        parent_id: str | None = None,
    ) -> dict[str, Any]:
        """Create a category node."""
        normalized_vendor = cls.ensure_vendor(connection, vendor)
        normalized_name = name.strip()
        if not normalized_name:
            raise DirectoryConflictError("Category name is required")

        parent = cls._get_category_row(connection, template_kind, parent_id) if parent_id else None
        if parent and parent["vendor"] != normalized_vendor:
            raise DirectoryConflictError("Parent category vendor does not match")

        cls._assert_unique_category_name(
            connection,
            template_kind,
            normalized_vendor,
            parent_id,
            normalized_name,
        )

        table_name = cls._category_table(template_kind)
        category_id = str(uuid.uuid4())
        timestamp = _current_timestamp()
        connection.execute(
            f"""
            INSERT INTO {table_name} (id, vendor, name, parent_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (category_id, normalized_vendor, normalized_name, parent_id, timestamp, timestamp),
        )
        return cls.get_category(connection, template_kind, category_id)

    @classmethod
    def get_category(
        cls,
        connection: sqlite3.Connection,
        template_kind: str,
        category_id: str,
    ) -> dict[str, Any]:
        """Return a single category."""
        table_name = cls._category_table(template_kind)
        row = connection.execute(
            f"""
            SELECT id, vendor, name, parent_id, created_at, updated_at
            FROM {table_name}
            WHERE id = ?
            """,
            (category_id,),
        ).fetchone()
        if row is None:
            raise DirectoryNotFoundError("Category not found")
        all_rows = connection.execute(
            f"""
            SELECT id, vendor, name, parent_id, created_at, updated_at
            FROM {table_name}
            """
        ).fetchall()
        for category in cls._rows_to_categories(all_rows):
            if category["id"] == category_id:
                return category
        raise DirectoryNotFoundError("Category not found")

    @classmethod
    def update_category(
        cls,
        connection: sqlite3.Connection,
        template_kind: str,
        category_id: str,
        name: str | None = None,
        vendor: str | None = None,
        parent_id: str | None = None,
    ) -> dict[str, Any]:
        """Rename or move a category node."""
        current_row = cls._get_category_row(connection, template_kind, category_id)
        if current_row is None:
            raise DirectoryNotFoundError("Category not found")

        next_name = (name or current_row["name"]).strip()
        if not next_name:
            raise DirectoryConflictError("Category name is required")

        next_vendor = cls._normalize_vendor(vendor or current_row["vendor"])
        cls.ensure_vendor(connection, next_vendor)

        normalized_parent_id = parent_id
        if normalized_parent_id == "":
            normalized_parent_id = None
        if normalized_parent_id == category_id:
            raise DirectoryConflictError("Category cannot be its own parent")

        parent = cls._get_category_row(connection, template_kind, normalized_parent_id) if normalized_parent_id else None
        if parent is not None:
            if parent["vendor"] != next_vendor:
                raise DirectoryConflictError("Parent category vendor does not match")
            descendant_ids = set(cls._collect_descendant_ids(connection, template_kind, category_id))
            if normalized_parent_id in descendant_ids:
                raise DirectoryConflictError("Category cannot be moved into its own subtree")

        cls._assert_unique_category_name(
            connection,
            template_kind,
            next_vendor,
            normalized_parent_id,
            next_name,
            exclude_category_id=category_id,
        )

        old_category = cls.get_category(connection, template_kind, category_id)
        timestamp = _current_timestamp()
        table_name = cls._category_table(template_kind)
        connection.execute(
            f"""
            UPDATE {table_name}
            SET vendor = ?, name = ?, parent_id = ?, updated_at = ?
            WHERE id = ?
            """,
            (next_vendor, next_name, normalized_parent_id, timestamp, category_id),
        )

        if old_category["vendor"] != next_vendor:
            descendant_ids = cls._collect_descendant_ids(connection, template_kind, category_id)
            if descendant_ids:
                placeholders = ", ".join(["?"] * len(descendant_ids))
                connection.execute(
                    f"UPDATE {table_name} SET vendor = ? WHERE id IN ({placeholders})",
                    (next_vendor, *descendant_ids),
                )

        new_category = cls.get_category(connection, template_kind, category_id)
        cls._rewrite_template_category_paths(
            connection,
            template_kind,
            old_category["vendor"],
            old_category["path"],
            new_category["vendor"],
            new_category["path"],
        )
        return new_category

    @classmethod
    def delete_category(
        cls,
        connection: sqlite3.Connection,
        template_kind: str,
        category_id: str,
    ) -> None:
        """Delete an empty category."""
        category = cls.get_category(connection, template_kind, category_id)
        table_name = cls._category_table(template_kind)

        if connection.execute(
            f"SELECT 1 FROM {table_name} WHERE parent_id = ? LIMIT 1",
            (category_id,),
        ).fetchone():
            raise DirectoryConflictError("Category still contains child categories")

        template_table = cls._template_table(template_kind)
        rows = connection.execute(
            f"SELECT category_path_json FROM {template_table} WHERE vendor = ?",
            (category["vendor"],),
        ).fetchall()
        prefix = category["path"]
        for row in rows:
            try:
                path = cls.normalize_category_path(json.loads(row["category_path_json"]))
            except Exception:
                path = []
            if len(path) >= len(prefix) and path[: len(prefix)] == prefix:
                raise DirectoryConflictError("Category still contains templates")

        connection.execute(
            f"DELETE FROM {table_name} WHERE id = ?",
            (category_id,),
        )

    @classmethod
    def ensure_category_path(
        cls,
        connection: sqlite3.Connection,
        template_kind: str,
        vendor: str,
        category_path: list[str] | None,
    ) -> tuple[str, list[str]]:
        """Ensure a vendor/category path exists and return normalized values."""
        normalized_vendor = cls.ensure_vendor(connection, vendor)
        normalized_path = cls.normalize_category_path(category_path)
        if not normalized_path:
            return normalized_vendor, []

        parent_id: str | None = None
        for segment in normalized_path:
            existing = cls._find_category_row(connection, template_kind, normalized_vendor, parent_id, segment)
            if existing is None:
                created = cls.create_category(
                    connection,
                    template_kind,
                    normalized_vendor,
                    segment,
                    parent_id=parent_id,
                )
                parent_id = created["id"]
            else:
                parent_id = existing["id"]

        return normalized_vendor, normalized_path

    @classmethod
    def _rename_template_vendor_records(
        cls,
        connection: sqlite3.Connection,
        template_kind: str,
        current_vendor: str,
        new_vendor: str,
    ) -> None:
        table_name = cls._template_table(template_kind)
        timestamp = _current_timestamp()
        connection.execute(
            f"""
            UPDATE {table_name}
            SET vendor = ?, updated_at = ?
            WHERE vendor = ?
            """,
            (new_vendor, timestamp, current_vendor),
        )

    @classmethod
    def _rewrite_template_category_paths(
        cls,
        connection: sqlite3.Connection,
        template_kind: str,
        old_vendor: str,
        old_path: list[str],
        new_vendor: str,
        new_path: list[str],
    ) -> None:
        if old_vendor == new_vendor and old_path == new_path:
            return

        table_name = cls._template_table(template_kind)
        rows = connection.execute(
            f"""
            SELECT id, category_path_json
            FROM {table_name}
            WHERE vendor = ?
            """,
            (old_vendor,),
        ).fetchall()
        timestamp = _current_timestamp()
        for row in rows:
            path = cls.normalize_category_path(json.loads(row["category_path_json"]))
            if len(path) < len(old_path) or path[: len(old_path)] != old_path:
                continue
            next_path = [*new_path, *path[len(old_path):]]
            connection.execute(
                f"""
                UPDATE {table_name}
                SET vendor = ?, category_path_json = ?, updated_at = ?
                WHERE id = ?
                """,
                (new_vendor, json.dumps(next_path, ensure_ascii=False), timestamp, row["id"]),
            )

    @classmethod
    def _rows_to_categories(cls, rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
        row_map = {row["id"]: row for row in rows}
        path_cache: dict[str, list[str]] = {}

        def build_path(row: sqlite3.Row) -> list[str]:
            row_id = row["id"]
            if row_id in path_cache:
                return path_cache[row_id]

            parent_id = row["parent_id"]
            if parent_id and parent_id in row_map:
                path = [*build_path(row_map[parent_id]), row["name"]]
            else:
                path = [row["name"]]
            path_cache[row_id] = path
            return path

        return [
            {
                "id": row["id"],
                "vendor": row["vendor"],
                "name": row["name"],
                "parent_id": row["parent_id"],
                "path": build_path(row),
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }
            for row in rows
        ]

    @classmethod
    def _get_category_row(
        cls,
        connection: sqlite3.Connection,
        template_kind: str,
        category_id: str | None,
    ) -> sqlite3.Row | None:
        if not category_id:
            return None
        table_name = cls._category_table(template_kind)
        return connection.execute(
            f"""
            SELECT id, vendor, name, parent_id, created_at, updated_at
            FROM {table_name}
            WHERE id = ?
            """,
            (category_id,),
        ).fetchone()

    @classmethod
    def _find_category_row(
        cls,
        connection: sqlite3.Connection,
        template_kind: str,
        vendor: str,
        parent_id: str | None,
        name: str,
    ) -> sqlite3.Row | None:
        table_name = cls._category_table(template_kind)
        if parent_id is None:
            return connection.execute(
                f"""
                SELECT id, vendor, name, parent_id, created_at, updated_at
                FROM {table_name}
                WHERE vendor = ? AND parent_id IS NULL AND name = ?
                """,
                (vendor, name),
            ).fetchone()
        return connection.execute(
            f"""
            SELECT id, vendor, name, parent_id, created_at, updated_at
            FROM {table_name}
            WHERE vendor = ? AND parent_id = ? AND name = ?
            """,
            (vendor, parent_id, name),
        ).fetchone()

    @classmethod
    def _assert_unique_category_name(
        cls,
        connection: sqlite3.Connection,
        template_kind: str,
        vendor: str,
        parent_id: str | None,
        name: str,
        exclude_category_id: str | None = None,
    ) -> None:
        row = cls._find_category_row(connection, template_kind, vendor, parent_id, name)
        if row is not None and row["id"] != exclude_category_id:
            raise DirectoryConflictError("Category already exists in this folder")

    @classmethod
    def _collect_descendant_ids(
        cls,
        connection: sqlite3.Connection,
        template_kind: str,
        category_id: str,
    ) -> list[str]:
        table_name = cls._category_table(template_kind)
        rows = connection.execute(
            f"SELECT id, parent_id FROM {table_name}"
        ).fetchall()
        children_by_parent: dict[str | None, list[str]] = {}
        for row in rows:
            children_by_parent.setdefault(row["parent_id"], []).append(row["id"])

        descendants: list[str] = []
        stack = list(children_by_parent.get(category_id, []))
        while stack:
            current_id = stack.pop()
            descendants.append(current_id)
            stack.extend(children_by_parent.get(current_id, []))
        return descendants
