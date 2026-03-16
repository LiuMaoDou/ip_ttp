"""SQLite-backed template persistence for the TTP Web UI."""
from __future__ import annotations

import json
import os
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any


DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / "data" / "ttp_web.db"


def _current_timestamp() -> int:
    """Return the current timestamp in milliseconds."""
    return time.time_ns() // 1_000_000


class TemplateService:
    """Service class for saved template persistence."""

    @classmethod
    def get_db_path(cls, db_path: str | Path | None = None) -> Path:
        """Resolve the SQLite database path."""
        configured_path = db_path or os.getenv("TTP_WEB_DB_PATH")
        path = Path(configured_path) if configured_path else DEFAULT_DB_PATH
        if not path.is_absolute():
            path = Path.cwd() / path
        return path

    @classmethod
    def initialize(cls, db_path: str | Path | None = None) -> Path:
        """Ensure the database directory and schema exist."""
        path = cls.get_db_path(db_path)
        path.parent.mkdir(parents=True, exist_ok=True)

        connection = sqlite3.connect(path)
        try:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS templates (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    sample_text TEXT NOT NULL,
                    variables_json TEXT NOT NULL,
                    groups_json TEXT NOT NULL,
                    generated_template TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                )
                """
            )
            connection.commit()
        finally:
            connection.close()

        return path

    @classmethod
    def _connect(cls, db_path: str | Path | None = None) -> sqlite3.Connection:
        """Create a SQLite connection with row access by column name."""
        path = cls.initialize(db_path)
        connection = sqlite3.connect(path)
        connection.row_factory = sqlite3.Row
        return connection

    @staticmethod
    def _encode_payload(value: Any) -> str:
        """Encode structured template data as JSON for storage."""
        return json.dumps(value, ensure_ascii=False)

    @staticmethod
    def _decode_payload(value: str) -> Any:
        """Decode structured template data from JSON storage."""
        return json.loads(value)

    @classmethod
    def _row_to_template(cls, row: sqlite3.Row) -> dict[str, Any]:
        """Convert a database row to the API-facing template shape."""
        return {
            "id": row["id"],
            "name": row["name"],
            "description": row["description"],
            "sample_text": row["sample_text"],
            "variables": cls._decode_payload(row["variables_json"]),
            "groups": cls._decode_payload(row["groups_json"]),
            "generated_template": row["generated_template"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    @classmethod
    def list_templates(cls, db_path: str | Path | None = None) -> list[dict[str, Any]]:
        """Return all saved templates."""
        connection = cls._connect(db_path)
        try:
            rows = connection.execute(
                """
                SELECT id, name, description, sample_text, variables_json, groups_json,
                       generated_template, created_at, updated_at
                FROM templates
                ORDER BY updated_at DESC, created_at DESC, name ASC
                """
            ).fetchall()
        finally:
            connection.close()

        return [cls._row_to_template(row) for row in rows]

    @classmethod
    def create_template(
        cls,
        name: str,
        description: str,
        sample_text: str,
        variables: list[dict[str, Any]],
        groups: list[dict[str, Any]],
        generated_template: str,
        db_path: str | Path | None = None,
    ) -> dict[str, Any]:
        """Create a saved template record."""
        template_id = str(uuid.uuid4())
        timestamp = _current_timestamp()

        connection = cls._connect(db_path)
        try:
            connection.execute(
                """
                INSERT INTO templates (
                    id, name, description, sample_text, variables_json, groups_json,
                    generated_template, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    template_id,
                    name,
                    description,
                    sample_text,
                    cls._encode_payload(variables),
                    cls._encode_payload(groups),
                    generated_template,
                    timestamp,
                    timestamp,
                ),
            )
            connection.commit()
        finally:
            connection.close()

        return cls.get_template(template_id, db_path)

    @classmethod
    def get_template(
        cls,
        template_id: str,
        db_path: str | Path | None = None,
    ) -> dict[str, Any] | None:
        """Return a single saved template by id."""
        connection = cls._connect(db_path)
        try:
            row = connection.execute(
                """
                SELECT id, name, description, sample_text, variables_json, groups_json,
                       generated_template, created_at, updated_at
                FROM templates
                WHERE id = ?
                """,
                (template_id,),
            ).fetchone()
        finally:
            connection.close()

        if row is None:
            return None

        return cls._row_to_template(row)

    @classmethod
    def update_template(
        cls,
        template_id: str,
        name: str,
        description: str,
        sample_text: str,
        variables: list[dict[str, Any]],
        groups: list[dict[str, Any]],
        generated_template: str,
        db_path: str | Path | None = None,
    ) -> dict[str, Any] | None:
        """Update a saved template by id."""
        timestamp = _current_timestamp()

        connection = cls._connect(db_path)
        try:
            result = connection.execute(
                """
                UPDATE templates
                SET name = ?,
                    description = ?,
                    sample_text = ?,
                    variables_json = ?,
                    groups_json = ?,
                    generated_template = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    name,
                    description,
                    sample_text,
                    cls._encode_payload(variables),
                    cls._encode_payload(groups),
                    generated_template,
                    timestamp,
                    template_id,
                ),
            )
            connection.commit()

            if result.rowcount == 0:
                return None
        finally:
            connection.close()

        return cls.get_template(template_id, db_path)

    @classmethod
    def delete_template(
        cls,
        template_id: str,
        db_path: str | Path | None = None,
    ) -> bool:
        """Delete a saved template by id."""
        connection = cls._connect(db_path)
        try:
            result = connection.execute(
                "DELETE FROM templates WHERE id = ?",
                (template_id,),
            )
            connection.commit()
        finally:
            connection.close()

        return result.rowcount > 0
