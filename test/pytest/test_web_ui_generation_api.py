import asyncio
import json
import sys

import httpx

sys.path.insert(0, "../..")

from backend.app.main import app
from backend.app.services import generation_service
from backend.app.services.template_directory_service import DEFAULT_VENDOR
from backend.app.services.generation_service import ConfigGenerationService, GenerationTemplateService

SOURCE_TEMPLATES = [
    {
        "template_id": "parse-template-1",
        "template_name": "interfaces",
        "template_alias": "interfaces",
    },
    {
        "template_id": "parse-template-2",
        "template_name": "neighbors",
        "template_alias": "neighbors",
    },
]

BINDINGS = [
    {
        "id": "binding-1",
        "start_line": 1,
        "start_column": 1,
        "end_line": 1,
        "end_column": 10,
        "original_text": "hostname",
        "reference": {
            "template_id": "parse-template-1",
            "template_name": "interfaces",
            "template_alias": "interfaces",
            "group_path": ["loopbacks"],
            "variable_name": "ip",
            "selector": "interfaces.loopbacks.ip",
            "expression": "{{ data.interfaces.loopbacks.ip }}",
        },
    },
    {
        "id": "binding-2",
        "start_line": 2,
        "start_column": 1,
        "end_line": 2,
        "end_column": 10,
        "original_text": "neighbor",
        "reference": {
            "template_id": "parse-template-2",
            "template_name": "neighbors",
            "template_alias": "neighbors",
            "group_path": [],
            "variable_name": "peer",
            "selector": "neighbors.peer",
            "expression": "{{ data.neighbors.peer }}",
        },
    },
]


def make_generation_payload(name="device-config"):
    return {
        "name": name,
        "description": "Generate device config",
        "vendor": "Cisco",
        "category_path": ["WAN", "BGP"],
        "template_text": "interface Lo0\n ip address {{ data.interfaces.loopbacks.ip }}\nneighbor {{ data.neighbors.peer }}",
        "source_templates": SOURCE_TEMPLATES,
        "bindings": BINDINGS,
    }


def test_generation_template_service_crud_and_json_roundtrip(tmp_path, monkeypatch):
    db_path = tmp_path / "ttp_web_generation.db"
    timestamps = iter([1000, 2000, 3000])
    monkeypatch.setattr(generation_service, "_current_timestamp", lambda: next(timestamps))

    initialized_path = GenerationTemplateService.initialize(db_path)

    assert initialized_path == db_path
    assert db_path.exists()
    assert GenerationTemplateService.list_templates(db_path) == []

    created = GenerationTemplateService.create_template(
        name="device-config",
        description="Generate device config",
        template_text="interface Lo0\n ip address {{ data.interfaces.loopbacks.ip }}",
        source_templates=SOURCE_TEMPLATES,
        bindings=BINDINGS,
        vendor="Cisco",
        category_path=["WAN", "BGP"],
        db_path=db_path,
    )

    assert created["name"] == "device-config"
    assert created["vendor"] == "Cisco"
    assert created["category_path"] == ["WAN", "BGP"]
    assert created["source_templates"] == SOURCE_TEMPLATES
    assert created["bindings"] == BINDINGS
    assert created["created_at"] == 1000
    assert created["updated_at"] == 1000

    updated = GenerationTemplateService.update_template(
        template_id=created["id"],
        name="device-config-v2",
        description="Updated generator",
        template_text="hostname {{ data.system.hostname }}",
        source_templates=SOURCE_TEMPLATES[:1],
        bindings=BINDINGS[:1],
        vendor="Cisco",
        category_path=["Access"],
        db_path=db_path,
    )

    assert updated is not None
    assert updated["name"] == "device-config-v2"
    assert updated["vendor"] == "Cisco"
    assert updated["category_path"] == ["Access"]
    assert updated["source_templates"] == SOURCE_TEMPLATES[:1]
    assert updated["bindings"] == BINDINGS[:1]
    assert updated["created_at"] == 1000
    assert updated["updated_at"] == 2000
    assert GenerationTemplateService.delete_template(created["id"], db_path) is True
    assert GenerationTemplateService.list_templates(db_path) == []


def test_config_generation_service_renders_namespaced_payload():
    output = ConfigGenerationService.render_batch(
        {
            "template_text": "interface Lo0\n ip address {{ data.interfaces.loopbacks.ip }}\nneighbor {{ data.neighbors.peer }}",
            "source_templates": SOURCE_TEMPLATES,
            "bindings": BINDINGS,
        },
        [
            {
                "file_name": "device.json",
                "payload": {"templates": {"interfaces": {"loopbacks": {"ip": "1.1.1.1/32"}}, "neighbors": {"peer": "10.0.0.1"}}},
            }
        ]
    )

    assert output == [
        {
            "file_name": "device.json",
            "success": True,
            "generated_text": "interface Lo0\n ip address 1.1.1.1/32\nneighbor 10.0.0.1",
        }
    ]


def test_config_generation_service_applies_bindings_before_rendering():
    output = ConfigGenerationService.render_batch(
        {
            "template_text": "interface Lo0\n ip address LOOPBACK_IP\nneighbor NEIGHBOR_IP",
            "source_templates": SOURCE_TEMPLATES,
            "bindings": [
                {
                    **BINDINGS[0],
                    "start_line": 2,
                    "start_column": 13,
                    "end_line": 2,
                    "end_column": 24,
                    "original_text": "LOOPBACK_IP",
                },
                {
                    **BINDINGS[1],
                    "start_line": 3,
                    "start_column": 10,
                    "end_line": 3,
                    "end_column": 21,
                    "original_text": "NEIGHBOR_IP",
                },
            ],
        },
        [
            {
                "file_name": "device.json",
                "payload": {"templates": {"interfaces": {"loopbacks": {"ip": "1.1.1.1/32"}}, "neighbors": {"peer": "10.0.0.1"}}},
            }
        ]
    )

    assert output == [
        {
            "file_name": "device.json",
            "success": True,
            "generated_text": "interface Lo0\n ip address 1.1.1.1/32\nneighbor 10.0.0.1",
        }
    ]


def test_config_generation_service_reports_overlapping_bindings():
    output = ConfigGenerationService.render_batch(
        {
            "template_text": "neighbor NEIGHBOR_IP",
            "source_templates": SOURCE_TEMPLATES,
            "bindings": [
                {
                    **BINDINGS[1],
                    "start_line": 1,
                    "start_column": 1,
                    "end_line": 1,
                    "end_column": 9,
                    "original_text": "neighbor",
                },
                {
                    **BINDINGS[1],
                    "id": "binding-3",
                    "start_line": 1,
                    "start_column": 5,
                    "end_line": 1,
                    "end_column": 16,
                    "original_text": "hbor NEIGHBO",
                },
            ],
        },
        [
            {
                "file_name": "device.json",
                "payload": {"templates": {"interfaces": {"loopbacks": {"ip": "1.1.1.1/32"}}, "neighbors": {"peer": "10.0.0.1"}}},
            }
        ]
    )

    assert output == [
        {
            "file_name": "device.json",
            "success": False,
            "error": "Overlapping bindings are not supported: neighbors.peer, neighbors.peer",
            "error_type": "ValueError",
        }
    ]


def test_config_generation_service_reports_missing_template_alias():
    output = ConfigGenerationService.render_batch(
        {
            "template_text": "interface Lo0\n ip address {{ data.interfaces.loopbacks.ip }}",
            "source_templates": SOURCE_TEMPLATES,
            "bindings": BINDINGS,
        },
        [
            {
                "file_name": "missing.json",
                "payload": {"templates": {"interfaces": {"loopbacks": {"ip": "1.1.1.1/32"}}}},
            }
        ]
    )

    assert output[0]["success"] is False
    assert output[0]["error_type"] == "ValueError"
    assert "neighbors" in output[0]["error"]


def test_config_generation_service_renders_repeated_group_bindings_with_loops():
    output = ConfigGenerationService.render_batch(
        {
            "template_text": "sysname SYSNAME\nip vpn-instance VRF_NAME\n route-distinguisher RD\n vpn-target RT_EXPORT export-extcommunity\n vpn-target RT_IMPORT import-extcommunity",
            "source_templates": [
                {
                    "template_id": "parse-template-1",
                    "template_name": "vrf",
                    "template_alias": "vrf",
                }
            ],
            "bindings": [
                {
                    "id": "binding-sysname",
                    "start_line": 1,
                    "start_column": 9,
                    "end_line": 1,
                    "end_column": 16,
                    "original_text": "SYSNAME",
                    "reference": {
                        "template_id": "parse-template-1",
                        "template_name": "vrf",
                        "template_alias": "vrf",
                        "group_path": [],
                        "variable_name": "sysName",
                        "selector": "vrf.sysName",
                        "expression": "{{ data.vrf.sysName }}",
                    },
                },
                {
                    "id": "binding-vrf-name",
                    "start_line": 2,
                    "start_column": 17,
                    "end_line": 2,
                    "end_column": 25,
                    "original_text": "VRF_NAME",
                    "reference": {
                        "template_id": "parse-template-1",
                        "template_name": "vrf",
                        "template_alias": "vrf",
                        "group_path": ["vrfs"],
                        "variable_name": "vrf",
                        "selector": "vrf.vrfs.vrf",
                        "expression": "{{ data.vrf.vrfs.vrf }}",
                    },
                },
                {
                    "id": "binding-rd",
                    "start_line": 3,
                    "start_column": 22,
                    "end_line": 3,
                    "end_column": 24,
                    "original_text": "RD",
                    "reference": {
                        "template_id": "parse-template-1",
                        "template_name": "vrf",
                        "template_alias": "vrf",
                        "group_path": ["vrfs"],
                        "variable_name": "rd",
                        "selector": "vrf.vrfs.rd",
                        "expression": "{{ data.vrf.vrfs.rd }}",
                    },
                },
                {
                    "id": "binding-rt-export",
                    "start_line": 4,
                    "start_column": 13,
                    "end_line": 4,
                    "end_column": 22,
                    "original_text": "RT_EXPORT",
                    "reference": {
                        "template_id": "parse-template-1",
                        "template_name": "vrf",
                        "template_alias": "vrf",
                        "group_path": ["vrfs"],
                        "variable_name": "rt_ex",
                        "selector": "vrf.vrfs.rt_ex",
                        "expression": "{{ data.vrf.vrfs.rt_ex }}",
                    },
                },
                {
                    "id": "binding-rt-import",
                    "start_line": 5,
                    "start_column": 13,
                    "end_line": 5,
                    "end_column": 22,
                    "original_text": "RT_IMPORT",
                    "reference": {
                        "template_id": "parse-template-1",
                        "template_name": "vrf",
                        "template_alias": "vrf",
                        "group_path": ["vrfs"],
                        "variable_name": "rt_in",
                        "selector": "vrf.vrfs.rt_in",
                        "expression": "{{ data.vrf.vrfs.rt_in }}",
                    },
                },
            ],
        },
        [
            {
                "file_name": "vrf.json",
                "payload": {
                    "templates": {
                        "vrf": {
                            "sysName": "PE2",
                            "vrfs": [
                                {"vrf": "VRF_01", "rd": "65000:1", "rt_ex": "65000:1", "rt_in": "65000:1"},
                                {"vrf": "VRF_02", "rd": "65000:2", "rt_ex": "65000:2", "rt_in": "65000:2"},
                            ],
                        }
                    }
                },
            }
        ]
    )

    assert output == [
        {
            "file_name": "vrf.json",
            "success": True,
            "generated_text": "sysname PE2\nip vpn-instance VRF_01\n route-distinguisher 65000:1\n vpn-target 65000:1 export-extcommunity\n vpn-target 65000:1 import-extcommunity\nip vpn-instance VRF_02\n route-distinguisher 65000:2\n vpn-target 65000:2 export-extcommunity\n vpn-target 65000:2 import-extcommunity",
        }
    ]


def test_config_generation_service_keeps_indented_block_and_separator_inside_repeated_group():
    output = ConfigGenerationService.render_batch(
        {
            "template_text": "system-view\n#\nsysname SYSNAME\n#\nip vpn-instance VRF_NAME\n ipv4-family\n  route-distinguisher RD\n  vpn-target RT_EXPORT export-extcommunity\n  vpn-target RT_IMPORT import-extcommunity\n#\nreturn",
            "source_templates": [
                {
                    "template_id": "parse-template-1",
                    "template_name": "vrf",
                    "template_alias": "vrf",
                }
            ],
            "bindings": [
                {
                    "id": "binding-sysname",
                    "start_line": 3,
                    "start_column": 9,
                    "end_line": 3,
                    "end_column": 16,
                    "original_text": "SYSNAME",
                    "reference": {
                        "template_id": "parse-template-1",
                        "template_name": "vrf",
                        "template_alias": "vrf",
                        "group_path": [],
                        "variable_name": "sysName",
                        "selector": "vrf.sysName",
                        "expression": "{{ data.vrf.sysName }}",
                    },
                },
                {
                    "id": "binding-vrf-name",
                    "start_line": 5,
                    "start_column": 17,
                    "end_line": 5,
                    "end_column": 25,
                    "original_text": "VRF_NAME",
                    "reference": {
                        "template_id": "parse-template-1",
                        "template_name": "vrf",
                        "template_alias": "vrf",
                        "group_path": ["vrfs"],
                        "variable_name": "vrf",
                        "selector": "vrf.vrfs.vrf",
                        "expression": "{{ data.vrf.vrfs.vrf }}",
                    },
                },
                {
                    "id": "binding-rd",
                    "start_line": 7,
                    "start_column": 23,
                    "end_line": 7,
                    "end_column": 25,
                    "original_text": "RD",
                    "reference": {
                        "template_id": "parse-template-1",
                        "template_name": "vrf",
                        "template_alias": "vrf",
                        "group_path": ["vrfs"],
                        "variable_name": "rd",
                        "selector": "vrf.vrfs.rd",
                        "expression": "{{ data.vrf.vrfs.rd }}",
                    },
                },
                {
                    "id": "binding-rt-export",
                    "start_line": 8,
                    "start_column": 14,
                    "end_line": 8,
                    "end_column": 23,
                    "original_text": "RT_EXPORT",
                    "reference": {
                        "template_id": "parse-template-1",
                        "template_name": "vrf",
                        "template_alias": "vrf",
                        "group_path": ["vrfs"],
                        "variable_name": "rt_ex",
                        "selector": "vrf.vrfs.rt_ex",
                        "expression": "{{ data.vrf.vrfs.rt_ex }}",
                    },
                },
                {
                    "id": "binding-rt-import",
                    "start_line": 9,
                    "start_column": 14,
                    "end_line": 9,
                    "end_column": 23,
                    "original_text": "RT_IMPORT",
                    "reference": {
                        "template_id": "parse-template-1",
                        "template_name": "vrf",
                        "template_alias": "vrf",
                        "group_path": ["vrfs"],
                        "variable_name": "rt_in",
                        "selector": "vrf.vrfs.rt_in",
                        "expression": "{{ data.vrf.vrfs.rt_in }}",
                    },
                },
            ],
        },
        [
            {
                "file_name": "vrf.json",
                "payload": {
                    "templates": {
                        "vrf": {
                            "sysName": "PE2",
                            "vrfs": [
                                {"vrf": "VRF_01", "rd": "65000:1", "rt_ex": "65000:1", "rt_in": "65000:1"},
                                {"vrf": "VRF_02", "rd": "65000:2", "rt_ex": "65000:2", "rt_in": "65000:2"},
                            ],
                        }
                    }
                },
            }
        ]
    )

    assert output == [
        {
            "file_name": "vrf.json",
            "success": True,
            "generated_text": "system-view\n#\nsysname PE2\n#\nip vpn-instance VRF_01\n ipv4-family\n  route-distinguisher 65000:1\n  vpn-target 65000:1 export-extcommunity\n  vpn-target 65000:1 import-extcommunity\n#\nip vpn-instance VRF_02\n ipv4-family\n  route-distinguisher 65000:2\n  vpn-target 65000:2 export-extcommunity\n  vpn-target 65000:2 import-extcommunity\n#\nreturn",
        }
    ]


def test_generation_api_crud_and_render_flow(tmp_path, monkeypatch):
    db_path = tmp_path / "ttp_web_generation_api.db"
    monkeypatch.setenv("TTP_WEB_DB_PATH", str(db_path))
    timestamps = iter([1000, 2000, 3000, 4000, 5000])
    monkeypatch.setattr(generation_service, "_current_timestamp", lambda: next(timestamps))

    async def run_test():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            empty_response = await client.get("/api/generation/templates")
            assert empty_response.status_code == 200
            assert empty_response.json() == {"templates": []}

            create_response = await client.post("/api/generation/templates", json=make_generation_payload())
            assert create_response.status_code == 201
            created = create_response.json()
            assert created["name"] == "device-config"
            assert created["vendor"] == "Cisco"
            assert created["category_path"] == ["WAN", "BGP"]
            assert created["source_templates"] == SOURCE_TEMPLATES
            assert created["bindings"] == BINDINGS

            render_response = await client.post(
                "/api/generation/render",
                data={"generation_template_id": created["id"]},
                files=[
                    (
                        "files",
                        (
                            "device.json",
                            '{"templates":{"interfaces":{"loopbacks":{"ip":"1.1.1.1/32"}},"neighbors":{"peer":"10.0.0.1"}}}',
                            "application/json",
                        ),
                    ),
                    (
                        "files",
                        (
                            "bad.json",
                            '{"templates":',
                            "application/json",
                        ),
                    ),
                ],
            )
            assert render_response.status_code == 200
            body = render_response.json()
            assert body["results"][0] == {
                "file_name": "device.json",
                "success": True,
                "generated_text": "interface Lo0\n ip address 1.1.1.1/32\nneighbor 10.0.0.1",
                "error": None,
                "error_type": None,
            }
            assert body["results"][1] == {
                "file_name": "bad.json",
                "success": False,
                "generated_text": None,
                "error": "Uploaded file is not valid JSON",
                "error_type": "JSONDecodeError",
            }

    asyncio.run(run_test())


def test_generation_api_renders_draft_payload_without_saved_template_id(tmp_path, monkeypatch):
    db_path = tmp_path / "ttp_web_generation_api_draft.db"
    monkeypatch.setenv("TTP_WEB_DB_PATH", str(db_path))

    async def run_test():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            render_response = await client.post(
                "/api/generation/render",
                data={"generation_template": json.dumps(make_generation_payload())},
                files=[
                    (
                        "files",
                        (
                            "device.json",
                            '{"templates":{"interfaces":{"loopbacks":{"ip":"1.1.1.1/32"}},"neighbors":{"peer":"10.0.0.1"}}}',
                            "application/json",
                        ),
                    )
                ],
            )

            assert render_response.status_code == 200
            assert render_response.json()["results"] == [
                {
                    "file_name": "device.json",
                    "success": True,
                    "generated_text": "interface Lo0\n ip address 1.1.1.1/32\nneighbor 10.0.0.1",
                    "error": None,
                    "error_type": None,
                }
            ]

    asyncio.run(run_test())


def test_generation_api_prefers_draft_payload_over_saved_template(tmp_path, monkeypatch):
    db_path = tmp_path / "ttp_web_generation_api_precedence.db"
    monkeypatch.setenv("TTP_WEB_DB_PATH", str(db_path))
    timestamps = iter([1000, 2000, 3000])
    monkeypatch.setattr(generation_service, "_current_timestamp", lambda: next(timestamps))

    async def run_test():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            create_response = await client.post("/api/generation/templates", json=make_generation_payload())
            assert create_response.status_code == 201
            created = create_response.json()
            assert created["vendor"] == "Cisco"

            draft_payload = make_generation_payload(name="draft-config")
            draft_payload["template_text"] = "hostname {{ data.interfaces.loopbacks.ip }}"
            draft_payload["source_templates"] = [SOURCE_TEMPLATES[0]]
            draft_payload["bindings"] = []

            render_response = await client.post(
                "/api/generation/render",
                data={
                    "generation_template_id": created["id"],
                    "generation_template": json.dumps(draft_payload),
                },
                files=[
                    (
                        "files",
                        (
                            "device.json",
                            '{"templates":{"interfaces":{"loopbacks":{"ip":"1.1.1.1/32"}},"neighbors":{"peer":"10.0.0.1"}}}',
                            "application/json",
                        ),
                    )
                ],
            )

            assert render_response.status_code == 200
            assert render_response.json()["results"][0]["generated_text"] == "hostname 1.1.1.1/32"

    asyncio.run(run_test())


def test_generation_directory_rename_updates_saved_template_vendor(tmp_path, monkeypatch):
    db_path = tmp_path / "ttp_web_generation_directories.db"
    monkeypatch.setenv("TTP_WEB_DB_PATH", str(db_path))
    timestamps = iter([1000, 2000, 3000, 4000])
    monkeypatch.setattr(generation_service, "_current_timestamp", lambda: next(timestamps))

    async def run_test():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            create_response = await client.post("/api/generation/templates", json=make_generation_payload())
            assert create_response.status_code == 201

            rename_vendor_response = await client.put(
                "/api/template-library/vendors/Cisco",
                json={"name": "Juniper"},
            )
            assert rename_vendor_response.status_code == 200

            list_response = await client.get("/api/generation/templates")
            assert list_response.status_code == 200
            assert list_response.json()["templates"][0]["vendor"] == "Juniper"

    asyncio.run(run_test())


def test_generation_api_requires_template_id_or_draft_payload(tmp_path, monkeypatch):
    db_path = tmp_path / "ttp_web_generation_api_missing_template.db"
    monkeypatch.setenv("TTP_WEB_DB_PATH", str(db_path))

    async def run_test():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            render_response = await client.post(
                "/api/generation/render",
                files=[
                    (
                        "files",
                        (
                            "device.json",
                            '{"templates":{"interfaces":{"loopbacks":{"ip":"1.1.1.1/32"}},"neighbors":{"peer":"10.0.0.1"}}}',
                            "application/json",
                        ),
                    )
                ],
            )

            assert render_response.status_code == 400
            assert render_response.json() == {
                "detail": "generation_template or generation_template_id is required"
            }

    asyncio.run(run_test())
