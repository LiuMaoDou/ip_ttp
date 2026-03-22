from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

import httpx


REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.app.main import app
from backend.app.services import generation_service, template_service


BASE_DIR = Path(__file__).resolve().parent
INPUT_DIR = BASE_DIR / "inputs"
EXPECTED_DIR = BASE_DIR / "expected"
ACTUAL_DIR = BASE_DIR / "actual"


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def assert_expected_json(actual_name: str, payload) -> None:
    expected = read_json(EXPECTED_DIR / actual_name)
    if payload != expected:
        raise AssertionError(
            f"Mismatch for {actual_name}\n"
            f"Expected: {json.dumps(expected, ensure_ascii=False, indent=2)}\n"
            f"Actual: {json.dumps(payload, ensure_ascii=False, indent=2)}"
        )


def prepare_actual_dir() -> Path:
    if ACTUAL_DIR.exists():
        shutil.rmtree(ACTUAL_DIR)
    ACTUAL_DIR.mkdir(parents=True, exist_ok=True)
    return ACTUAL_DIR / "runtime_feature.db"


def patch_deterministic_ids_and_timestamps():
    generated_ids = iter(
        [
            uuid.UUID("00000000-0000-0000-0000-000000000001"),
            uuid.UUID("00000000-0000-0000-0000-000000000101"),
        ]
    )
    template_times = iter([1000, 2000])
    generation_times = iter([3000, 4000])

    template_service.uuid.uuid4 = lambda: next(generated_ids)
    generation_service.uuid.uuid4 = lambda: next(generated_ids)
    template_service._current_timestamp = lambda: next(template_times)
    generation_service._current_timestamp = lambda: next(generation_times)


async def run_api_checks(summary: list[dict[str, object]]) -> None:
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        patterns = (await client.get("/api/patterns")).json()
        write_json(ACTUAL_DIR / "patterns_response.json", patterns)
        assert_expected_json("patterns_response.json", patterns)
        summary.append({"feature": "patterns", "status": "passed"})

        parse_plain_request = read_json(INPUT_DIR / "parse_plain_request.json")
        parse_plain = (await client.post("/api/parse", json=parse_plain_request)).json()
        write_json(ACTUAL_DIR / "parse_plain_response.json", parse_plain)
        assert_expected_json("parse_plain_response.json", parse_plain)
        summary.append({"feature": "parse_plain", "status": "passed"})

        parse_named_request = read_json(INPUT_DIR / "parse_named_request.json")
        parse_named = (await client.post("/api/parse", json=parse_named_request)).json()
        write_json(ACTUAL_DIR / "parse_named_response.json", parse_named)
        assert_expected_json("parse_named_response.json", parse_named)
        summary.append({"feature": "parse_named", "status": "passed"})

        parse_file = (
            await client.post(
                "/api/parse/file",
                data={"template": read_text(INPUT_DIR / "parse_file_template.txt")},
                files={
                    "file": (
                        "sample.txt",
                        read_text(INPUT_DIR / "parse_file_input.txt").encode("utf-8"),
                        "text/plain",
                    )
                },
            )
        ).json()
        write_json(ACTUAL_DIR / "parse_file_response.json", parse_file)
        assert_expected_json("parse_file_response.json", parse_file)
        summary.append({"feature": "parse_file", "status": "passed"})

        template_create_payload = read_json(INPUT_DIR / "template_create_payload.json")
        template_create = (await client.post("/api/templates", json=template_create_payload)).json()
        write_json(ACTUAL_DIR / "templates_create_response.json", template_create)
        assert_expected_json("templates_create_response.json", template_create)
        summary.append({"feature": "templates_create", "status": "passed"})

        template_id = template_create["id"]
        template_update_payload = read_json(INPUT_DIR / "template_update_payload.json")
        template_update = (
            await client.put(f"/api/templates/{template_id}", json=template_update_payload)
        ).json()
        write_json(ACTUAL_DIR / "templates_update_response.json", template_update)
        assert_expected_json("templates_update_response.json", template_update)
        summary.append({"feature": "templates_update", "status": "passed"})

        template_list = (await client.get("/api/templates")).json()
        write_json(ACTUAL_DIR / "templates_list_after_update_response.json", template_list)
        assert_expected_json("templates_list_after_update_response.json", template_list)
        summary.append({"feature": "templates_list", "status": "passed"})

        template_delete_response = await client.delete(f"/api/templates/{template_id}")
        template_delete = {
            "status_code": template_delete_response.status_code,
            "body": template_delete_response.text,
        }
        write_json(ACTUAL_DIR / "templates_delete_response.json", template_delete)
        assert_expected_json("templates_delete_response.json", template_delete)
        summary.append({"feature": "templates_delete", "status": "passed"})

        generation_create_payload = read_json(INPUT_DIR / "generation_create_payload.json")
        generation_create = (
            await client.post("/api/generation/templates", json=generation_create_payload)
        ).json()
        write_json(ACTUAL_DIR / "generation_create_response.json", generation_create)
        assert_expected_json("generation_create_response.json", generation_create)
        summary.append({"feature": "generation_templates_create", "status": "passed"})

        generation_id = generation_create["id"]
        generation_render_saved = (
            await client.post(
                "/api/generation/render",
                data={"generation_template_id": generation_id},
                files=[
                    (
                        "files",
                        (
                            "device.json",
                            read_text(INPUT_DIR / "generation_render_device.json"),
                            "application/json",
                        ),
                    ),
                    (
                        "files",
                        (
                            "bad.json",
                            read_text(INPUT_DIR / "generation_render_bad.json.txt"),
                            "application/json",
                        ),
                    ),
                ],
            )
        ).json()
        write_json(ACTUAL_DIR / "generation_render_saved_response.json", generation_render_saved)
        assert_expected_json("generation_render_saved_response.json", generation_render_saved)
        summary.append({"feature": "generation_render_saved", "status": "passed"})

        generation_update_payload = read_json(INPUT_DIR / "generation_update_payload.json")
        generation_update = (
            await client.put(
                f"/api/generation/templates/{generation_id}",
                json=generation_update_payload,
            )
        ).json()
        write_json(ACTUAL_DIR / "generation_update_response.json", generation_update)
        assert_expected_json("generation_update_response.json", generation_update)
        summary.append({"feature": "generation_templates_update", "status": "passed"})

        generation_list = (await client.get("/api/generation/templates")).json()
        write_json(ACTUAL_DIR / "generation_list_after_update_response.json", generation_list)
        assert_expected_json("generation_list_after_update_response.json", generation_list)
        summary.append({"feature": "generation_templates_list", "status": "passed"})

        generation_render_draft = (
            await client.post(
                "/api/generation/render",
                data={
                    "generation_template": json.dumps(
                        read_json(INPUT_DIR / "generation_draft_payload.json")
                    )
                },
                files=[
                    (
                        "files",
                        (
                            "device.json",
                            read_text(INPUT_DIR / "generation_render_device.json"),
                            "application/json",
                        ),
                    )
                ],
            )
        ).json()
        write_json(ACTUAL_DIR / "generation_render_draft_response.json", generation_render_draft)
        assert_expected_json("generation_render_draft_response.json", generation_render_draft)
        summary.append({"feature": "generation_render_draft", "status": "passed"})

        generation_render_loop = (
            await client.post(
                "/api/generation/render",
                data={
                    "generation_template": json.dumps(
                        read_json(INPUT_DIR / "generation_loop_payload.json")
                    )
                },
                files=[
                    (
                        "files",
                        (
                            "vrf.json",
                            read_text(INPUT_DIR / "generation_render_vrf.json"),
                            "application/json",
                        ),
                    )
                ],
            )
        ).json()
        write_json(ACTUAL_DIR / "generation_render_loop_response.json", generation_render_loop)
        assert_expected_json("generation_render_loop_response.json", generation_render_loop)
        summary.append({"feature": "generation_render_loop", "status": "passed"})

        generation_delete_response = await client.delete(
            f"/api/generation/templates/{generation_id}"
        )
        generation_delete = {
            "status_code": generation_delete_response.status_code,
            "body": generation_delete_response.text,
        }
        write_json(ACTUAL_DIR / "generation_delete_response.json", generation_delete)
        assert_expected_json("generation_delete_response.json", generation_delete)
        summary.append({"feature": "generation_templates_delete", "status": "passed"})


def run_frontend_build(summary: list[dict[str, object]]) -> None:
    frontend_dist = ACTUAL_DIR / "frontend_dist"
    command = [
        "npm.cmd",
        "run",
        "build",
        "--",
        "--outDir",
        str(frontend_dist),
    ]
    result = subprocess.run(
        command,
        cwd=REPO_ROOT / "frontend",
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    build_log = (result.stdout or "") + (result.stderr or "")
    write_text(ACTUAL_DIR / "frontend_build.log", build_log)

    payload = {
        "success": result.returncode == 0,
        "exit_code": result.returncode,
    }
    write_json(ACTUAL_DIR / "frontend_build_response.json", payload)
    assert_expected_json("frontend_build_response.json", payload)
    summary.append({"feature": "frontend_build", "status": "passed"})


def main() -> int:
    runtime_db = prepare_actual_dir()
    os.environ["TTP_WEB_DB_PATH"] = str(runtime_db)
    template_service.TemplateService.initialize(runtime_db)
    generation_service.GenerationTemplateService.initialize(runtime_db)
    patch_deterministic_ids_and_timestamps()

    summary: list[dict[str, object]] = []
    try:
        asyncio.run(run_api_checks(summary))
        run_frontend_build(summary)
        write_json(
            ACTUAL_DIR / "summary.json",
            {
                "status": "passed",
                "features": summary,
            },
        )
        print(f"Feature checks passed. Outputs written to {ACTUAL_DIR}")
        return 0
    except Exception as exc:
        write_json(
            ACTUAL_DIR / "summary.json",
            {
                "status": "failed",
                "features": summary,
                "error": str(exc),
                "error_type": type(exc).__name__,
            },
        )
        raise


if __name__ == "__main__":
    raise SystemExit(main())



