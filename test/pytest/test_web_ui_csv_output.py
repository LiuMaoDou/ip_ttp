import csv
import io
import sys

sys.path.insert(0, "../..")

from backend.app.services.ttp_service import TTPService


def test_csv_matches_simple_list_result():
    data = """
interface Lo0
 ip address 1.1.1.1/32
!
interface Lo1
 ip address 2.2.2.2/32
!
"""
    template = """
<group>
interface {{ interface }}
 ip address {{ ip }}/{{ mask }}
</group>
"""

    result = TTPService.parse(data=data, template=template)

    assert result["success"] is True
    assert result["result"] == [
        {"interface": "Lo0", "ip": "1.1.1.1", "mask": "32"},
        {"interface": "Lo1", "ip": "2.2.2.2", "mask": "32"},
    ]
    assert result["csv_result"] == (
        '"ip","mask","interface"\n'
        '"1.1.1.1","32","Lo0"\n'
        '"2.2.2.2","32","Lo1"'
    )
    assert result["checkup_csv_result"] == (
        '"line_text","parse_status"\n'
        '"","X 未解析"\n'
        '"interface Lo0","√ 解析"\n'
        '" ip address 1.1.1.1/32","√ 解析"\n'
        '"!","X 未解析"\n'
        '"interface Lo1","√ 解析"\n'
        '" ip address 2.2.2.2/32","√ 解析"\n'
        '"!","X 未解析"'
    )


def test_csv_uses_single_wrapped_list_path():
    data = """
interface Lo0
 ip address 1.1.1.1/32
!
interface Lo1
 ip address 2.2.2.2/32
!
"""
    template = """
<group name="interfaces*">
interface {{ interface }}
 ip address {{ ip }}/{{ mask }}
</group>
"""

    result = TTPService.parse(data=data, template=template)

    assert result["success"] is True
    assert result["result"] == {
        "interfaces": [
            {"interface": "Lo0", "ip": "1.1.1.1", "mask": "32"},
            {"interface": "Lo1", "ip": "2.2.2.2", "mask": "32"},
        ]
    }
    assert result["csv_result"] == (
        '"ip","mask","interface"\n'
        '"1.1.1.1","32","Lo0"\n'
        '"2.2.2.2","32","Lo1"'
    )


def test_csv_expands_dict_of_dicts_with_key_column():
    data = """
interface Lo0
 ip address 1.1.1.1/32
 description Primary loopback
!
interface Lo1
 ip address 2.2.2.2/32
!
"""
    template = """
<group name="interfaces.{{ interface }}">
interface {{ interface }}
 ip address {{ ip }}/{{ mask }}
 description {{ description | ORPHRASE }}
</group>
"""

    result = TTPService.parse(data=data, template=template)

    assert result["success"] is True
    assert result["result"] == {
        "interfaces": {
            "Lo0": {"ip": "1.1.1.1", "mask": "32", "description": "Primary loopback"},
            "Lo1": {"ip": "2.2.2.2", "mask": "32"},
        }
    }
    assert result["csv_result"] == (
        '"interface","description","ip","mask"\n'
        '"Lo0","Primary loopback","1.1.1.1","32"\n'
        '"Lo1","","2.2.2.2","32"'
    )


def test_csv_returns_full_string_for_multirow_result():
    data = """
interface Lo0
 ip address 1.1.1.1/32
!
interface Lo1
 ip address 2.2.2.2/32
!
"""
    template = """
<group>
interface {{ interface }}
 ip address {{ ip }}/{{ mask }}
</group>
"""

    result = TTPService.parse(data=data, template=template)

    assert result["success"] is True
    assert result["csv_result"].count("\n") == 2

    rows = list(csv.DictReader(io.StringIO(result["csv_result"])))

    assert rows == [
        {"ip": "1.1.1.1", "mask": "32", "interface": "Lo0"},
        {"ip": "2.2.2.2", "mask": "32", "interface": "Lo1"},
    ]


def test_csv_returns_empty_for_ambiguous_multi_table_result():
    data = """
neighbor 10.0.0.1
neighbor 10.0.0.2
route 192.0.2.0/24
route 198.51.100.0/24
"""
    template = """
<group name="neighbors*">
neighbor {{ peer }}
</group>
<group name="routes*">
route {{ prefix }}
</group>
"""

    result = TTPService.parse(data=data, template=template)

    assert result["success"] is True
    assert result["result"] == {
        "neighbors": [{"peer": "10.0.0.1"}, {"peer": "10.0.0.2"}],
        "routes": [{"prefix": "192.0.2.0/24"}, {"prefix": "198.51.100.0/24"}],
    }
    assert result["csv_result"] == ""
