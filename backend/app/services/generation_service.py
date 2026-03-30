"""Persistence and rendering services for config generation templates."""
from __future__ import annotations

import json
import os
import re
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any

from .template_service import DEFAULT_DB_PATH
from .template_directory_service import (
    DEFAULT_VENDOR,
    TEMPLATE_KIND_GENERATION,
    TemplateDirectoryService,
)


def _current_timestamp() -> int:
    """Return the current timestamp in milliseconds."""
    return time.time_ns() // 1_000_000


class GenerationTemplateService:
    """Service class for config generation template persistence."""

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
            connection.row_factory = sqlite3.Row
            TemplateDirectoryService.initialize(connection)
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS generation_templates (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    vendor TEXT NOT NULL DEFAULT 'Unassigned',
                    category_path_json TEXT NOT NULL DEFAULT '[]',
                    template_text TEXT NOT NULL,
                    source_templates_json TEXT NOT NULL,
                    bindings_json TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                )
                """
            )
            columns = {
                row["name"]
                for row in connection.execute("PRAGMA table_info(generation_templates)").fetchall()
            }
            if "vendor" not in columns:
                connection.execute(
                    "ALTER TABLE generation_templates ADD COLUMN vendor TEXT NOT NULL DEFAULT 'Unassigned'"
                )
            if "category_path_json" not in columns:
                connection.execute(
                    "ALTER TABLE generation_templates ADD COLUMN category_path_json TEXT NOT NULL DEFAULT '[]'"
                )
            TemplateDirectoryService.ensure_vendor(connection, DEFAULT_VENDOR)
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
        """Encode structured data as JSON for storage."""
        return json.dumps(value, ensure_ascii=False)

    @staticmethod
    def _decode_payload(value: str) -> Any:
        """Decode structured JSON payload."""
        return json.loads(value)

    @classmethod
    def _row_to_template(cls, row: sqlite3.Row) -> dict[str, Any]:
        """Convert a database row to the API-facing generation template shape."""
        return {
            "id": row["id"],
            "name": row["name"],
            "description": row["description"],
            "vendor": row["vendor"],
            "category_path": cls._decode_payload(row["category_path_json"]),
            "template_text": row["template_text"],
            "source_templates": cls._decode_payload(row["source_templates_json"]),
            "bindings": cls._decode_payload(row["bindings_json"]),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    @classmethod
    def list_templates(cls, db_path: str | Path | None = None) -> list[dict[str, Any]]:
        """Return all saved generation templates."""
        connection = cls._connect(db_path)
        try:
            rows = connection.execute(
                """
                SELECT id, name, description, vendor, category_path_json, template_text,
                       source_templates_json, bindings_json, created_at, updated_at
                FROM generation_templates
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
        template_text: str,
        source_templates: list[dict[str, Any]],
        bindings: list[dict[str, Any]],
        vendor: str = DEFAULT_VENDOR,
        category_path: list[str] | None = None,
        db_path: str | Path | None = None,
    ) -> dict[str, Any]:
        """Create a saved generation template record."""
        template_id = str(uuid.uuid4())
        timestamp = _current_timestamp()

        connection = cls._connect(db_path)
        try:
            normalized_vendor, normalized_category_path = TemplateDirectoryService.ensure_category_path(
                connection,
                TEMPLATE_KIND_GENERATION,
                vendor,
                category_path,
            )
            connection.execute(
                """
                INSERT INTO generation_templates (
                    id, name, description, vendor, category_path_json, template_text,
                    source_templates_json, bindings_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    template_id,
                    name,
                    description,
                    normalized_vendor,
                    cls._encode_payload(normalized_category_path),
                    template_text,
                    cls._encode_payload(source_templates),
                    cls._encode_payload(bindings),
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
        """Return a single saved generation template by id."""
        connection = cls._connect(db_path)
        try:
            row = connection.execute(
                """
                SELECT id, name, description, vendor, category_path_json, template_text,
                       source_templates_json, bindings_json, created_at, updated_at
                FROM generation_templates
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
        template_text: str,
        source_templates: list[dict[str, Any]],
        bindings: list[dict[str, Any]],
        vendor: str = DEFAULT_VENDOR,
        category_path: list[str] | None = None,
        db_path: str | Path | None = None,
    ) -> dict[str, Any] | None:
        """Update a saved generation template by id."""
        timestamp = _current_timestamp()

        connection = cls._connect(db_path)
        try:
            normalized_vendor, normalized_category_path = TemplateDirectoryService.ensure_category_path(
                connection,
                TEMPLATE_KIND_GENERATION,
                vendor,
                category_path,
            )
            result = connection.execute(
                """
                UPDATE generation_templates
                SET name = ?,
                    description = ?,
                    vendor = ?,
                    category_path_json = ?,
                    template_text = ?,
                    source_templates_json = ?,
                    bindings_json = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    name,
                    description,
                    normalized_vendor,
                    cls._encode_payload(normalized_category_path),
                    template_text,
                    cls._encode_payload(source_templates),
                    cls._encode_payload(bindings),
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
        """Delete a saved generation template by id."""
        connection = cls._connect(db_path)
        try:
            result = connection.execute(
                "DELETE FROM generation_templates WHERE id = ?",
                (template_id,),
            )
            connection.commit()
        finally:
            connection.close()

        return result.rowcount > 0


class BindingApplicationError(ValueError):
    """Base error for invalid binding application state."""


class BindingTextMismatchError(BindingApplicationError):
    """Raised when stored binding coordinates no longer match template text."""


class ConfigGenerationService:
    """Service class for config generation rendering."""

    _PLACEHOLDER_PATTERN = re.compile(r"\{\{\s*data\.([a-zA-Z0-9_\.]+)\s*\}\}")
    _LOOP_PLACEHOLDER_PATTERN = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_\.]*)\s*\}\}")
    _FOR_BLOCK_PATTERN = re.compile(
        r"\{%\s*for\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+in\s+data\.([a-zA-Z0-9_\.]+)\s*%\}(.*?)\{%\s*endfor\s*%\}",
        re.DOTALL,
    )

    @classmethod
    def _lookup_path(cls, payload: Any, path: str) -> Any:
        """Resolve a dot-delimited path from nested dict/list data."""
        current = payload
        for segment in path.split('.'):
            if isinstance(current, dict):
                if segment not in current:
                    raise ValueError(f"Missing value for selector path: {path}")
                current = current[segment]
                continue

            if isinstance(current, list) and segment.isdigit():
                index = int(segment)
                try:
                    current = current[index]
                except IndexError as exc:
                    raise ValueError(f"Missing list item for selector path: {path}") from exc
                continue

            raise ValueError(f"Missing value for selector path: {path}")

        return current

    @classmethod
    def _lookup_loop_path(cls, context: dict[str, Any], path: str) -> Any:
        """Resolve a dot-delimited path from loop render context."""
        current: Any = context
        for segment in path.split('.'):
            if isinstance(current, dict):
                if segment not in current:
                    raise ValueError(f"Missing value for selector path: {path}")
                current = current[segment]
                continue

            if isinstance(current, list) and segment.isdigit():
                index = int(segment)
                try:
                    current = current[index]
                except IndexError as exc:
                    raise ValueError(f"Missing list item for selector path: {path}") from exc
                continue

            raise ValueError(f"Missing value for selector path: {path}")

        return current

    @classmethod
    def _render_loop_body(cls, template_text: str, context: dict[str, Any]) -> str:
        """Render placeholders inside a loop body using loop-local context."""

        def replace(match: re.Match[str]) -> str:
            expression = match.group(1)
            if expression.startswith("data."):
                value = cls._lookup_path(context.get("data"), expression[5:])
            else:
                value = cls._lookup_loop_path(context, expression)
            if isinstance(value, (dict, list)):
                return json.dumps(value, ensure_ascii=False)
            return str(value)

        return cls._LOOP_PLACEHOLDER_PATTERN.sub(replace, template_text)

    @classmethod
    def _render_without_jinja2(cls, template_text: str, payload: Any) -> str:
        """Render the limited placeholder subset without Jinja2."""

        def render_loops(text: str) -> str:
            while True:
                match = cls._FOR_BLOCK_PATTERN.search(text)
                if not match:
                    return text

                loop_var = match.group(1)
                path = match.group(2)
                body = match.group(3)
                items = cls._lookup_path(payload, path)
                if not isinstance(items, list):
                    raise ValueError(f"Missing value for selector path: {path}")

                rendered_body = "".join(
                    cls._render_loop_body(body, {"data": payload, loop_var: item}).lstrip("\n")
                    for item in items
                )
                suffix = text[match.end():]
                if rendered_body.endswith("\n") and suffix.startswith("\n"):
                    rendered_body = rendered_body[:-1]
                text = f"{text[:match.start()]}{rendered_body}{suffix}"

        def replace(match: re.Match[str]) -> str:
            value = cls._lookup_path(payload, match.group(1))
            if isinstance(value, (dict, list)):
                return json.dumps(value, ensure_ascii=False)
            return str(value)

        text = render_loops(template_text)
        return cls._PLACEHOLDER_PATTERN.sub(replace, text).rstrip("\n")

    @staticmethod
    def _create_environment():
        """Create a sandboxed Jinja2 environment on demand."""
        try:
            from jinja2 import StrictUndefined
            from jinja2.sandbox import SandboxedEnvironment
        except ImportError:
            return None

        return SandboxedEnvironment(
            trim_blocks=True,
            lstrip_blocks=True,
            undefined=StrictUndefined,
        )

    @staticmethod
    def _normalize_json_payload(payload: Any) -> dict[str, Any]:
        """Normalize the uploaded JSON envelope into template-scoped data."""
        if not isinstance(payload, dict):
            raise ValueError("Uploaded JSON must be an object keyed by template alias")

        if isinstance(payload.get("templates"), dict):
            return payload["templates"]

        return payload

    @staticmethod
    def _required_aliases(generation_template: dict[str, Any]) -> list[str]:
        """Collect required template aliases from bindings only.

        Source templates are informational metadata (available data catalog) and
        are not required to be present in every uploaded JSON file.
        """
        aliases: list[str] = []

        for binding in generation_template.get("bindings", []):
            reference = binding.get("reference") or {}
            alias = reference.get("template_alias") or reference.get("templateAlias")
            if alias and alias not in aliases:
                aliases.append(alias)

        return aliases

    @classmethod
    def _validate_payload(
        cls,
        payload: Any,
        generation_template: dict[str, Any],
    ) -> dict[str, Any]:
        """Normalize the uploaded JSON payload into template-scoped data."""
        return cls._normalize_json_payload(payload)

    @staticmethod
    def _binding_expression(binding: dict[str, Any]) -> str:
        """Build the default expression for a binding from its metadata."""
        reference = binding.get("reference") or {}
        alias = reference.get("template_alias") or reference.get("templateAlias")
        group_path = reference.get("group_path") or reference.get("groupPath") or []
        variable_name = reference.get("variable_name") or reference.get("variableName")
        if alias and variable_name:
            path = ".".join([alias, *group_path, variable_name])
            return f"{{{{ data.{path} }}}}"

        expression = reference.get("expression")
        if expression:
            return expression

        raise ValueError("Binding is missing render expression")

    @staticmethod
    def _binding_reference_parts(binding: dict[str, Any]) -> tuple[str, list[str], str]:
        """Return normalized binding reference fields."""
        reference = binding.get("reference") or {}
        alias = reference.get("template_alias") or reference.get("templateAlias") or ""
        group_path = reference.get("group_path") or reference.get("groupPath") or []
        variable_name = reference.get("variable_name") or reference.get("variableName") or ""
        return alias, list(group_path), variable_name

    @staticmethod
    def _safe_identifier(value: str, fallback: str = "item") -> str:
        """Convert arbitrary text into a safe Jinja loop variable name."""
        identifier = re.sub(r"[^a-zA-Z0-9_]+", "_", value).strip("_")
        if not identifier:
            identifier = fallback
        if identifier[0].isdigit():
            identifier = f"_{identifier}"
        return identifier

    @staticmethod
    def _singularize(name: str) -> str:
        """Best-effort singularization for generated loop variable names."""
        if name.endswith("ies") and len(name) > 3:
            return name[:-3] + "y"
        if name.endswith("s") and len(name) > 1 and not name.endswith("ss"):
            return name[:-1]
        return name

    @staticmethod
    def _line_offsets(template_text: str) -> tuple[list[str], list[int]]:
        """Return split lines and absolute offsets for each line start."""
        lines = template_text.split("\n")
        offsets = [0]
        offset = 0
        for line in lines[:-1]:
            offset += len(line) + 1
            offsets.append(offset)
        return lines, offsets

    @staticmethod
    def _line_indent(line: str) -> int:
        """Return the indentation width for a template line."""
        return len(line) - len(line.lstrip(" "))

    @staticmethod
    def _is_separator_line(line: str) -> bool:
        """Return True for separator-only lines that should stay with a repeated block."""
        stripped = line.strip()
        return stripped in {"#", "!"}

    @classmethod
    def _should_merge_repeated_candidate(
        cls,
        lines: list[str],
        start_line: int,
        end_line: int,
        base_indent: int,
    ) -> bool:
        """Return True when the gap between repeated bindings belongs to the same block."""
        for line_number in range(start_line, end_line + 1):
            stripped = lines[line_number - 1].strip()
            if not stripped or cls._is_separator_line(lines[line_number - 1]):
                continue
            if cls._line_indent(lines[line_number - 1]) > base_indent:
                continue
            return False
        return True

    @classmethod
    def _expand_repeated_cluster_end(
        cls,
        lines: list[str],
        end_line: int,
        base_indent: int,
    ) -> int:
        """Include trailing separator and indented lines that belong to a repeated block."""
        expanded_end = end_line
        while expanded_end < len(lines):
            next_line = lines[expanded_end]
            stripped = next_line.strip()
            if not stripped or cls._is_separator_line(next_line):
                expanded_end += 1
                continue
            if cls._line_indent(next_line) > base_indent:
                expanded_end += 1
                continue
            break
        return expanded_end

    @staticmethod
    def _selection_to_offsets(template_text: str, binding: dict[str, Any]) -> tuple[int, int]:
        """Convert a binding selection into absolute string offsets."""
        start_line = binding.get("start_line") or binding.get("startLine")
        start_column = binding.get("start_column") or binding.get("startColumn")
        end_line = binding.get("end_line") or binding.get("endLine")
        end_column = binding.get("end_column") or binding.get("endColumn")

        positions = (start_line, start_column, end_line, end_column)
        if not all(isinstance(value, int) for value in positions):
            raise ValueError("Binding positions must be integers")

        if start_line < 1 or start_column < 1 or end_line < 1 or end_column < 1:
            raise ValueError("Binding positions must be positive")

        if start_line > end_line or (start_line == end_line and start_column >= end_column):
            raise ValueError("Binding range is invalid")

        lines, line_offsets = ConfigGenerationService._line_offsets(template_text)
        if start_line > len(lines) or end_line > len(lines):
            raise ValueError("Binding line range is outside the template text")

        start_line_text = lines[start_line - 1]
        end_line_text = lines[end_line - 1]
        if start_column > len(start_line_text) + 1 or end_column > len(end_line_text) + 1:
            raise ValueError("Binding column range is outside the template text")

        start_offset = line_offsets[start_line - 1] + start_column - 1
        end_offset = line_offsets[end_line - 1] + end_column - 1
        return start_offset, end_offset

    @classmethod
    def _apply_bindings(
        cls,
        template_text: str,
        bindings: list[dict[str, Any]],
        payload: dict[str, Any] | None = None,
    ) -> str:
        """Replace bound selections with render expressions and wrap repeated groups in loops."""
        if not bindings:
            return template_text

        lines, line_offsets = cls._line_offsets(template_text)
        used_loop_vars: set[str] = set()
        candidates: list[dict[str, Any]] = []

        for binding in bindings:
            expression = cls._binding_expression(binding)
            alias, group_path, variable_name = cls._binding_reference_parts(binding)
            container_path = ".".join([alias, *group_path]) if alias and group_path else ""
            container_value: Any = None
            if payload is not None and container_path:
                try:
                    container_value = cls._lookup_path(payload, container_path)
                except ValueError:
                    container_value = None

            repeated_group = isinstance(container_value, list) and bool(variable_name)
            try:
                start_offset, end_offset = cls._selection_to_offsets(template_text, binding)
            except ValueError:
                if expression in template_text:
                    continue
                raise

            selected_text = template_text[start_offset:end_offset]
            if selected_text == expression:
                continue

            candidates.append(
                {
                    "start_offset": start_offset,
                    "end_offset": end_offset,
                    "binding": binding,
                    "selected_text": selected_text,
                    "default_expression": expression,
                    "alias": alias,
                    "group_path": group_path,
                    "variable_name": variable_name,
                    "container_path": container_path,
                    "repeated_group": repeated_group,
                    "start_line": binding.get("start_line") or binding.get("startLine"),
                    "end_line": binding.get("end_line") or binding.get("endLine"),
                }
            )

        ordered_candidates = sorted(candidates, key=lambda item: (item["start_offset"], item["end_offset"]))
        for index, candidate in enumerate(ordered_candidates[1:], start=1):
            previous = ordered_candidates[index - 1]
            if candidate["start_offset"] < previous["end_offset"]:
                previous_reference = previous["binding"].get("reference") or {}
                current_reference = candidate["binding"].get("reference") or {}
                previous_selector = previous_reference.get("selector") or previous["binding"].get("id") or "binding"
                current_selector = current_reference.get("selector") or candidate["binding"].get("id") or "binding"
                raise ValueError(
                    f"Overlapping bindings are not supported: {previous_selector}, {current_selector}"
                )

        repeated_clusters: list[dict[str, Any]] = []
        repeated_candidates = [candidate for candidate in ordered_candidates if candidate["repeated_group"]]
        grouped_candidates: dict[str, list[dict[str, Any]]] = {}
        for candidate in repeated_candidates:
            grouped_candidates.setdefault(candidate["container_path"], []).append(candidate)

        for container_path, group_candidates in grouped_candidates.items():
            sorted_group_candidates = sorted(
                group_candidates,
                key=lambda item: (item["start_line"], item["end_line"], item["start_offset"]),
            )
            current_cluster: dict[str, Any] | None = None
            for candidate in sorted_group_candidates:
                candidate_base_indent = cls._line_indent(lines[candidate["start_line"] - 1])

                if current_cluster is None:
                    loop_base = cls._safe_identifier(
                        cls._singularize(candidate["group_path"][-1] if candidate["group_path"] else "item")
                    )
                    loop_var = loop_base
                    suffix = 2
                    while loop_var in used_loop_vars:
                        loop_var = f"{loop_base}_{suffix}"
                        suffix += 1
                    used_loop_vars.add(loop_var)
                    current_cluster = {
                        "container_path": container_path,
                        "start_line": candidate["start_line"],
                        "end_line": candidate["end_line"],
                        "base_indent": candidate_base_indent,
                        "loop_var": loop_var,
                        "candidates": [candidate],
                    }
                    repeated_clusters.append(current_cluster)
                    continue

                should_merge = cls._should_merge_repeated_candidate(
                    lines,
                    current_cluster["end_line"] + 1,
                    candidate["start_line"] - 1,
                    current_cluster["base_indent"],
                )
                if not should_merge:
                    loop_base = cls._safe_identifier(
                        cls._singularize(candidate["group_path"][-1] if candidate["group_path"] else "item")
                    )
                    loop_var = loop_base
                    suffix = 2
                    while loop_var in used_loop_vars:
                        loop_var = f"{loop_base}_{suffix}"
                        suffix += 1
                    used_loop_vars.add(loop_var)
                    current_cluster = {
                        "container_path": container_path,
                        "start_line": candidate["start_line"],
                        "end_line": candidate["end_line"],
                        "base_indent": candidate_base_indent,
                        "loop_var": loop_var,
                        "candidates": [candidate],
                    }
                    repeated_clusters.append(current_cluster)
                    continue

                current_cluster["end_line"] = max(current_cluster["end_line"], candidate["end_line"])
                current_cluster["candidates"].append(candidate)

        for cluster in repeated_clusters:
            cluster["end_line"] = cls._expand_repeated_cluster_end(
                lines,
                cluster["end_line"],
                cluster["base_indent"],
            )
            start_offset = line_offsets[cluster["start_line"] - 1]
            end_offset = line_offsets[cluster["end_line"] - 1] + len(lines[cluster["end_line"] - 1])
            cluster["start_offset"] = start_offset
            cluster["end_offset"] = end_offset

        ordered_clusters = sorted(repeated_clusters, key=lambda item: (item["start_offset"], item["end_offset"]))
        for index, cluster in enumerate(ordered_clusters[1:], start=1):
            previous = ordered_clusters[index - 1]
            if cluster["start_offset"] < previous["end_offset"]:
                raise ValueError("Overlapping repeated-group bindings are not supported")

        cluster_by_binding_id: dict[str, dict[str, Any]] = {}
        for cluster in repeated_clusters:
            for candidate in cluster["candidates"]:
                binding_id = candidate["binding"].get("id")
                if binding_id:
                    cluster_by_binding_id[binding_id] = cluster

        replacements: list[dict[str, Any]] = []
        for candidate in ordered_candidates:
            binding = candidate["binding"]
            cluster = cluster_by_binding_id.get(binding.get("id") or "")
            if cluster is not None:
                expression = f"{{{{ {cluster['loop_var']}.{candidate['variable_name']} }}}}"
            else:
                expression = candidate["default_expression"]

            original_text = binding.get("original_text") or binding.get("originalText") or ""
            if original_text and candidate["selected_text"] != original_text:
                if expression in template_text or candidate["default_expression"] in template_text:
                    continue
                raise BindingTextMismatchError(
                    f"Binding text no longer matches template content: {binding.get('id') or 'binding'}"
                )

            replacements.append(
                {
                    "kind": "replacement",
                    "offset": candidate["start_offset"],
                    "end_offset": candidate["end_offset"],
                    "text": expression,
                    "priority": 2,
                }
            )

        insertions: list[dict[str, Any]] = []
        for cluster in repeated_clusters:
            insertions.append(
                {
                    "kind": "insertion",
                    "offset": cluster["start_offset"],
                    "text": f"{{% for {cluster['loop_var']} in data.{cluster['container_path']} %}}\n",
                    "priority": 0,
                }
            )
            insertions.append(
                {
                    "kind": "insertion",
                    "offset": cluster["end_offset"],
                    "text": "\n{% endfor %}",
                    "priority": 1,
                }
            )

        actions = sorted(
            [*replacements, *insertions],
            key=lambda item: (item["offset"], item["priority"]),
            reverse=True,
        )

        rendered_template = template_text
        for action in actions:
            if action["kind"] == "replacement":
                rendered_template = (
                    f"{rendered_template[:action['offset']]}"
                    f"{action['text']}"
                    f"{rendered_template[action['end_offset']:]}"
                )
            else:
                rendered_template = (
                    f"{rendered_template[:action['offset']]}"
                    f"{action['text']}"
                    f"{rendered_template[action['offset']:]}"
                )

        return rendered_template

    @classmethod
    def render_template(cls, template_text: str, payload: Any) -> str:
        """Render a config generation template with uploaded JSON payload."""
        environment = cls._create_environment()
        if environment is None:
            return cls._render_without_jinja2(template_text, payload)

        template = environment.from_string(template_text)
        return template.render(data=payload).rstrip("\n")

    @classmethod
    def render_batch(
        cls,
        generation_template: dict[str, Any],
        files: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Render a generation template for each uploaded JSON file."""
        results: list[dict[str, Any]] = []
        environment = cls._create_environment()

        for file in files:
            file_name = file["file_name"]
            try:
                namespaced_data = cls._validate_payload(file["payload"], generation_template)
                rendered_template_text = cls._apply_bindings(
                    generation_template["template_text"],
                    generation_template.get("bindings", []),
                    namespaced_data,
                )
                if environment is None:
                    generated_text = cls._render_without_jinja2(rendered_template_text, namespaced_data)
                else:
                    template = environment.from_string(rendered_template_text)
                    generated_text = template.render(data=namespaced_data).rstrip("\n")
                results.append(
                    {
                        "file_name": file_name,
                        "success": True,
                        "generated_text": generated_text,
                    }
                )
            except Exception as exc:
                results.append(
                    {
                        "file_name": file_name,
                        "success": False,
                        "error": str(exc),
                        "error_type": type(exc).__name__,
                    }
                )

        return results
