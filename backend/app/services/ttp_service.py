"""TTP Service - Wraps TTP library for parsing operations."""
from typing import Any, Optional
from ttp import ttp
from ttp.patterns import get_pattern


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
    def parse(cls, data: str, template: str) -> dict[str, Any]:
        """
        Parse data using TTP template.

        Args:
            data: Raw text data to parse
            template: TTP template string

        Returns:
            Dict with success status and result or error
        """
        try:
            parser = ttp(data=data, template=template)
            parser.parse()

            result = parser.result()
            csv_result = parser.result(format="csv", returner="self")

            if isinstance(result, list) and len(result) > 0:
                result = result[0]
                if isinstance(result, list) and len(result) > 0:
                    result = result[0]

            csv_output = csv_result[0] if isinstance(csv_result, list) and len(csv_result) > 0 else ""

            return {
                "success": True,
                "result": result,
                "csv_result": csv_output
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
