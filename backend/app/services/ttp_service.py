"""TTP Service - Wraps TTP library for parsing operations."""
import csv
import io
import sys
from pathlib import Path
from copy import deepcopy
from typing import Any, Optional

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from ttp import ttp
from ttp.patterns import get_pattern
from ttp.ttp import _outputter_class


def _normalize_result(raw_result: Any) -> Any:
    """Mirror the existing API result unwrapping behavior."""
    normalized_result = raw_result
    for _ in range(2):
        if isinstance(normalized_result, list) and normalized_result:
            normalized_result = normalized_result[0]
    return normalized_result


def _is_tabular_row(value: Any) -> bool:
    """Return True when value can be represented as a flat table row."""
    return isinstance(value, dict) and bool(value) and all(
        not isinstance(item, (dict, list)) for item in value.values()
    )


def _is_list_of_tabular_rows(value: Any) -> bool:
    """Return True when value is a non-empty list of flat dictionaries."""
    return isinstance(value, list) and bool(value) and all(
        _is_tabular_row(item) for item in value
    )


def _is_dict_of_tabular_rows(value: Any) -> bool:
    """Return True when value is a non-empty dict of flat dictionaries."""
    return isinstance(value, dict) and bool(value) and all(
        _is_tabular_row(item) for item in value.values()
    )


def _singularize(name: str) -> str:
    """Best-effort singularization for generated key column names."""
    if name.endswith("ies") and len(name) > 3:
        return name[:-3] + "y"
    if name.endswith("s") and len(name) > 1 and not name.endswith("ss"):
        return name[:-1]
    return name


def _choose_key_name(path: list[str], rows: list[dict[str, Any]]) -> str:
    """Pick a non-conflicting key column name for dict-of-dicts data."""
    existing_headers = {header for row in rows for header in row}
    candidates = []

    if path:
        candidates.append(_singularize(path[-1]))
        candidates.append(f"{path[-1]}_key")

    candidates.extend(["key", "item_key"])

    for candidate in candidates:
        if candidate and candidate not in existing_headers:
            return candidate

    suffix = 1
    while f"key_{suffix}" in existing_headers:
        suffix += 1
    return f"key_{suffix}"


def _reorder_result_keys(result: Any, variable_names: list[str]) -> Any:
    """Recursively reorder dict keys to match variable_names order."""
    if isinstance(result, list):
        return [_reorder_result_keys(item, variable_names) for item in result]
    if isinstance(result, dict):
        name_set = set(variable_names)
        ordered: dict[str, Any] = {k: result[k] for k in variable_names if k in result}
        ordered.update({k: v for k, v in result.items() if k not in name_set})
        return {k: _reorder_result_keys(v, variable_names) for k, v in ordered.items()}
    return result


def _collect_headers(rows: list[dict[str, Any]], key_name: Optional[str] = None, variable_names: Optional[list[str]] = None) -> list[str]:
    """Collect CSV headers in a stable order."""
    headers: list[str] = []
    seen: set[str] = set()

    if key_name:
        headers.append(key_name)
        seen.add(key_name)

    for row in rows:
        for header in row:
            if header not in seen:
                headers.append(header)
                seen.add(header)

    if variable_names:
        ordered = [h for h in variable_names if h in seen]
        ordered += [h for h in headers if h not in set(variable_names)]
        return ordered

    return headers


def _find_tabular_candidates(
    data: Any, path: Optional[list[str]] = None
) -> list[dict[str, Any]]:
    """Find tabular data candidates addressable by the TTP table formatter."""
    current_path = path or []

    if _is_list_of_tabular_rows(data):
        return [{"path": current_path, "rows": data, "key": None}]

    if _is_dict_of_tabular_rows(data):
        if not current_path and len(data) == 1:
            return []
        key_name = _choose_key_name(current_path, list(data.values()))
        rows = [{key_name: item_key, **row} for item_key, row in data.items()]
        return [{"path": current_path, "rows": rows, "key": key_name}]

    if isinstance(data, dict):
        candidates = []
        for key, value in data.items():
            candidates.extend(_find_tabular_candidates(value, current_path + [key]))
        return candidates

    return []


def _choose_candidate(candidates: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """Pick a single safe table candidate or return None when ambiguous."""
    if len(candidates) != 1:
        return None
    return candidates[0]


def _format_csv_from_normalized_result(parser: ttp, normalized_result: Any, variable_names: Optional[list[str]] = None) -> str:
    """Run TTP's native CSV formatter against normalized API results."""
    candidate = _choose_candidate(_find_tabular_candidates(deepcopy(normalized_result)))
    if not candidate:
        return ""

    headers = _collect_headers(candidate["rows"], candidate["key"], variable_names)
    if not headers:
        return ""

    outputter = _outputter_class(
        _ttp_=parser._ttp_,
        format="csv",
        returner="self",
        headers=headers,
        missing="",
    )

    if candidate["path"]:
        outputter.attributes["path"] = candidate["path"]
    if candidate["key"]:
        outputter.attributes["key"] = candidate["key"]

    return outputter.run(deepcopy(normalized_result))


def _line_start_offsets(data: str) -> list[int]:
    """Return absolute offsets for the first character of each original input line."""
    offsets = [1]
    for index, char in enumerate(data):
        if char == "\n":
            offsets.append(index + 2)
    return offsets


def _line_end_offset(line_start: int, line_text: str) -> int:
    """Return exclusive absolute end offset for a line in parser DATATEXT coordinates."""
    return line_start + len(line_text)


def _line_is_covered(line_start: int, line_end: int, spans: list[tuple[int, int]]) -> bool:
    """Return True when any accepted span touches the line's text range."""
    for span_start, span_end in spans:
        if span_end <= line_start:
            continue
        if span_start >= line_end:
            continue
        return True
    return False


def _generate_checkup_csv(data: str, accepted_match_spans: list[tuple[int, int]]) -> str:
    """Build a CSV with original lines and parsed/unparsed status."""
    output = io.StringIO(newline="")
    writer = csv.writer(output, quoting=csv.QUOTE_ALL, lineterminator="\n")
    writer.writerow(["line_text", "parse_status"])

    lines = data.splitlines()
    line_starts = _line_start_offsets(data)

    for index, line_text in enumerate(lines):
        line_start = line_starts[index]
        line_end = _line_end_offset(line_start, line_text)
        parse_status = (
            "√ 解析"
            if _line_is_covered(line_start, line_end, accepted_match_spans)
            else "X 未解析"
        )
        writer.writerow([line_text, parse_status])

    return output.getvalue().rstrip("\n")


class TTPService:
    """Service class for TTP parsing operations."""

    # Available built-in patterns
    PATTERNS = {
        "IP": {
            "regex": r"(?:[0-9]{1,3}\.){3}[0-9]{1,3}",
            "description": "IPv4 address"
        },
        "IPV6": {
            "regex": r"(?:[a-fA-F0-9]{1,4}:|:){1,7}(?:[a-fA-F0-9]{1,4}|:?)",
            "description": "IPv6 address"
        },
        "MAC": {
            "regex": r"(?:[0-9a-fA-F]{2}(:|\.|\-)){5}([0-9a-fA-F]{2})|(?:[0-9a-fA-F]{4}(:|\.|\-)){2}([0-9a-fA-F]{4})",
            "description": "MAC address"
        },
        "DIGIT": {
            "regex": r"\d+",
            "description": "Numeric digits"
        },
        "PREFIX": {
            "regex": r"(?:[0-9]{1,3}\.){3}[0-9]{1,3}/[0-9]{1,2}",
            "description": "IPv4 prefix with CIDR"
        },
        "PREFIXV6": {
            "regex": r"(?:[a-fA-F0-9]{1,4}:|:){1,7}(?:[a-fA-F0-9]{1,4}|:?)/[0-9]{1,3}",
            "description": "IPv6 prefix with CIDR"
        },
        "WORD": {
            "regex": r"\S+",
            "description": "Single word (non-whitespace)"
        },
        "PHRASE": {
            "regex": r"(\S+ {1})+?\S+",
            "description": "Multi-word phrase"
        },
        "ORPHRASE": {
            "regex": r"\S+|(\S+ {1})+?\S+",
            "description": "Optional phrase (single or multi-word)"
        },
        "ROW": {
            "regex": r"(\S+ +)+?\S+",
            "description": "Table row"
        },
        "_line_": {
            "regex": r".+",
            "description": "Any line"
        }
    }

    @classmethod
    def parse(
        cls,
        data: str,
        template: str,
        include_csv: bool = True,
        include_checkup: bool = True,
        variable_names: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        """
        Parse data using TTP template.

        Args:
            data: Raw text data to parse
            template: TTP template string
            include_csv: Whether to build csv_result
            include_checkup: Whether to build checkup_csv_result

        Returns:
            Dict with success status and result or error
        """
        try:
            parser = ttp(data=data, template=template)
            parser.parse()

            raw_result = parser.result()
            normalized_result = _normalize_result(raw_result)
            if variable_names:
                normalized_result = _reorder_result_keys(normalized_result, variable_names)
            csv_result = (
                _format_csv_from_normalized_result(parser, normalized_result, variable_names)
                if include_csv
                else ""
            )
            checkup_csv_result = (
                _generate_checkup_csv(
                    data=data,
                    accepted_match_spans=list(getattr(parser, "_last_accepted_match_spans", [])),
                )
                if include_checkup
                else ""
            )

            return {
                "success": True,
                "result": normalized_result,
                "csv_result": csv_result,
                "checkup_csv_result": checkup_csv_result,
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "error_type": type(e).__name__
            }

    @classmethod
    def get_patterns(cls) -> dict[str, dict[str, str]]:
        """Get all available built-in patterns."""
        return cls.PATTERNS

    @classmethod
    def get_pattern_regex(cls, name: str) -> Optional[str]:
        """Get regex for a specific pattern name."""
        pattern = get_pattern.get(name)
        if pattern:
            return pattern
        return cls.PATTERNS.get(name, {}).get("regex")
