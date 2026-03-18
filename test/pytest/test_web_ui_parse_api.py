import asyncio
import sys

import httpx

sys.path.insert(0, "../..")

from backend.app.main import app


def test_parse_api_returns_checkup_csv_for_matched_and_unmatched_lines():
    payload = {
        "data": "interface Lo0\n ip address 1.1.1.1/32\n!\n",
        "template": "<group>\ninterface {{ interface }}\n ip address {{ ip }}/{{ mask }}\n</group>",
    }

    async def run_test():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.post("/api/parse", json=payload)
            assert response.status_code == 200

            body = response.json()
            assert body["success"] is True
            assert body["result"] == [{"interface": "Lo0", "ip": "1.1.1.1", "mask": "32"}]
            assert body["checkup_csv_result"] == (
                '"line_text","parse_status"\n'
                '"interface Lo0","√ 解析"\n'
                '" ip address 1.1.1.1/32","√ 解析"\n'
                '"!","X 未解析"'
            )

    asyncio.run(run_test())


def test_parse_api_wraps_named_template_and_returns_checkup_csv():
    payload = {
        "data": "interface Lo0\n ip address 1.1.1.1/32\n",
        "template": "interface {{ interface }}\n ip address {{ ip }}/{{ mask }}",
        "name": "interfaces",
    }

    async def run_test():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.post("/api/parse", json=payload)
            assert response.status_code == 200

            body = response.json()
            assert body["success"] is True
            assert body["result"] == {"interfaces": {"interface": "Lo0", "ip": "1.1.1.1", "mask": "32"}}
            assert body["checkup_csv_result"] == (
                '"line_text","parse_status"\n'
                '"interface Lo0","√ 解析"\n'
                '" ip address 1.1.1.1/32","√ 解析"'
            )

    asyncio.run(run_test())
