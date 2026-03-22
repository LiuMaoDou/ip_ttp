import asyncio
import sys

import httpx

sys.path.insert(0, "../..")

from backend.app.main import app
from backend.app.services import template_service
from backend.app.services.template_directory_service import DEFAULT_VENDOR
from backend.app.services.template_service import TemplateService


VARIABLES = [
    {
        "id": "var-1",
        "name": "interface",
        "pattern": "WORD",
        "indicators": [],
        "syntaxMode": "variable",
        "ignoreValue": None,
        "headersColumns": None,
        "startLine": 1,
        "startColumn": 11,
        "endLine": 1,
        "endColumn": 14,
        "originalText": "Lo0",
        "colorIndex": 0,
    }
]

GROUPS = [
    {
        "id": "grp-1",
        "name": "interfaces",
        "startLine": 1,
        "endLine": 2,
        "colorIndex": 0,
    }
]


def make_template_payload(
    name="interfaces",
    description="Loopback parser",
    vendor="Cisco",
    category_path=None,
):
    return {
        "name": name,
        "description": description,
        "vendor": vendor,
        "category_path": category_path or ["Core", "Interfaces"],
        "sample_text": "interface Lo0\n ip address 1.1.1.1/32",
        "variables": VARIABLES,
        "groups": GROUPS,
        "generated_template": '<group name="interfaces">\ninterface {{ interface }}\n</group>',
    }


def test_template_service_crud_and_json_roundtrip(tmp_path, monkeypatch):
    db_path = tmp_path / "ttp_web.db"
    timestamps = iter([1000, 2000, 3000])
    monkeypatch.setattr(template_service, "_current_timestamp", lambda: next(timestamps))

    initialized_path = TemplateService.initialize(db_path)

    assert initialized_path == db_path
    assert db_path.exists()
    assert TemplateService.list_templates(db_path) == []

    created = TemplateService.create_template(
        name="interfaces",
        description="Loopback parser",
        sample_text="interface Lo0\n ip address 1.1.1.1/32",
        variables=VARIABLES,
        groups=GROUPS,
        generated_template='<group name="interfaces">\ninterface {{ interface }}\n</group>',
        vendor="Cisco",
        category_path=["Core", "Interfaces"],
        db_path=db_path,
    )

    assert created["name"] == "interfaces"
    assert created["description"] == "Loopback parser"
    assert created["vendor"] == "Cisco"
    assert created["category_path"] == ["Core", "Interfaces"]
    assert created["variables"] == VARIABLES
    assert created["groups"] == GROUPS
    assert created["created_at"] == 1000
    assert created["updated_at"] == 1000

    listed = TemplateService.list_templates(db_path)
    assert len(listed) == 1
    assert listed[0] == created

    updated = TemplateService.update_template(
        template_id=created["id"],
        name="interfaces-v2",
        description="Updated loopback parser",
        sample_text="interface Lo1\n ip address 2.2.2.2/32",
        variables=VARIABLES,
        groups=[],
        generated_template='<group name="interfaces">\ninterface {{ interface }}\n ip address {{ ip }}\n</group>',
        vendor="Cisco",
        category_path=["Edge"],
        db_path=db_path,
    )

    assert updated is not None
    assert updated["id"] == created["id"]
    assert updated["name"] == "interfaces-v2"
    assert updated["description"] == "Updated loopback parser"
    assert updated["vendor"] == "Cisco"
    assert updated["category_path"] == ["Edge"]
    assert updated["sample_text"] == "interface Lo1\n ip address 2.2.2.2/32"
    assert updated["variables"] == VARIABLES
    assert updated["groups"] == []
    assert updated["created_at"] == 1000
    assert updated["updated_at"] == 2000

    assert TemplateService.get_template(created["id"], db_path)["name"] == "interfaces-v2"
    assert TemplateService.update_template(
        template_id="missing",
        name="missing",
        description="",
        sample_text="",
        variables=[],
        groups=[],
        generated_template="",
        vendor=DEFAULT_VENDOR,
        category_path=[],
        db_path=db_path,
    ) is None

    assert TemplateService.delete_template(created["id"], db_path) is True
    assert TemplateService.list_templates(db_path) == []
    assert TemplateService.delete_template(created["id"], db_path) is False


def test_templates_api_crud_flow(tmp_path, monkeypatch):
    db_path = tmp_path / "ttp_web_api.db"
    monkeypatch.setenv("TTP_WEB_DB_PATH", str(db_path))
    timestamps = iter([1000, 2000, 3000, 4000, 5000])
    monkeypatch.setattr(template_service, "_current_timestamp", lambda: next(timestamps))

    async def run_test():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            empty_response = await client.get("/api/templates")
            assert empty_response.status_code == 200
            assert empty_response.json() == {"templates": []}

            create_response = await client.post("/api/templates", json=make_template_payload())
            assert create_response.status_code == 201
            created = create_response.json()
            assert created["name"] == "interfaces"
            assert created["description"] == "Loopback parser"
            assert created["vendor"] == "Cisco"
            assert created["category_path"] == ["Core", "Interfaces"]
            assert created["sample_text"] == "interface Lo0\n ip address 1.1.1.1/32"
            assert created["variables"] == VARIABLES
            assert created["groups"] == GROUPS
            assert created["created_at"] == 1000
            assert created["updated_at"] == 1000

            list_response = await client.get("/api/templates")
            assert list_response.status_code == 200
            assert list_response.json() == {"templates": [created]}

            template_id = created["id"]
            updated_payload = make_template_payload(name="interfaces-v2", description="Updated loopback parser")
            updated_payload["sample_text"] = "interface Lo1\n ip address 2.2.2.2/32"
            updated_payload["groups"] = []
            updated_payload["generated_template"] = (
                '<group name="interfaces">\ninterface {{ interface }}\n ip address {{ ip }}\n</group>'
            )

            update_response = await client.put(f"/api/templates/{template_id}", json=updated_payload)
            assert update_response.status_code == 200
            updated = update_response.json()
            assert updated["id"] == template_id
            assert updated["name"] == "interfaces-v2"
            assert updated["description"] == "Updated loopback parser"
            assert updated["vendor"] == "Cisco"
            assert updated["category_path"] == ["Core", "Interfaces"]
            assert updated["sample_text"] == "interface Lo1\n ip address 2.2.2.2/32"
            assert updated["groups"] == []
            assert updated["created_at"] == 1000
            assert updated["updated_at"] == 2000

            list_after_update = await client.get("/api/templates")
            assert list_after_update.status_code == 200
            assert list_after_update.json() == {"templates": [updated]}

            delete_response = await client.delete(f"/api/templates/{template_id}")
            assert delete_response.status_code == 204
            assert delete_response.text == ""

            final_list_response = await client.get("/api/templates")
            assert final_list_response.status_code == 200
            assert final_list_response.json() == {"templates": []}

    asyncio.run(run_test())


def test_template_directory_api_vendor_and_category_flow(tmp_path, monkeypatch):
    db_path = tmp_path / "ttp_web_directories.db"
    monkeypatch.setenv("TTP_WEB_DB_PATH", str(db_path))

    async def run_test():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            vendors_response = await client.get("/api/template-library/vendors")
            assert vendors_response.status_code == 200
            assert vendors_response.json()["vendors"][0]["name"] == DEFAULT_VENDOR

            create_vendor_response = await client.post(
                "/api/template-library/vendors",
                json={"name": "Huawei"},
            )
            assert create_vendor_response.status_code == 201
            assert create_vendor_response.json()["name"] == "Huawei"

            create_category_response = await client.post(
                "/api/template-library/parse/categories",
                json={"name": "Core", "vendor": "Huawei", "parent_id": None},
            )
            assert create_category_response.status_code == 201
            category = create_category_response.json()
            assert category["vendor"] == "Huawei"
            assert category["path"] == ["Core"]

            rename_vendor_response = await client.put(
                "/api/template-library/vendors/Huawei",
                json={"name": "H3C"},
            )
            assert rename_vendor_response.status_code == 200
            assert rename_vendor_response.json()["name"] == "H3C"

            list_categories_response = await client.get("/api/template-library/parse/categories")
            assert list_categories_response.status_code == 200
            assert list_categories_response.json()["categories"][0]["vendor"] == "H3C"

    asyncio.run(run_test())


def test_templates_api_returns_404_for_missing_template(tmp_path, monkeypatch):
    db_path = tmp_path / "ttp_web_api_missing.db"
    monkeypatch.setenv("TTP_WEB_DB_PATH", str(db_path))
    timestamps = iter([1000, 2000, 3000])
    monkeypatch.setattr(template_service, "_current_timestamp", lambda: next(timestamps))

    async def run_test():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            update_response = await client.put("/api/templates/missing", json=make_template_payload())
            assert update_response.status_code == 404
            assert update_response.json() == {"detail": "Template not found"}

            delete_response = await client.delete("/api/templates/missing")
            assert delete_response.status_code == 404
            assert delete_response.json() == {"detail": "Template not found"}

    asyncio.run(run_test())
