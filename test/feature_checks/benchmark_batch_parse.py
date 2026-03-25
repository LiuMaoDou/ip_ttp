from __future__ import annotations

import argparse
import asyncio
import io
import json
import os
import statistics
import subprocess
import sys
import time
import zipfile
from pathlib import Path

import httpx


REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


TEMPLATE = (
    '<group name="interfaces">'
    "interface {{ name }}\n"
    " description {{ description | ORPHRASE }}\n"
    " ip address {{ ip }} {{ mask }}\n"
    " mtu {{ mtu }}\n"
    " state {{ state }}\n"
    "</group>"
)


def build_case_matrix() -> list[dict[str, str]]:
    return [
        {"name": "w8-p16", "workers": "8", "pending": "16"},
        {"name": "w12-p24", "workers": "12", "pending": "24"},
        {"name": "w16-p32", "workers": "16", "pending": "32"},
    ]


def build_synthetic_file(file_index: int, sections_per_file: int) -> str:
    lines: list[str] = []
    for section_index in range(sections_per_file):
        iface_index = file_index * sections_per_file + section_index
        lines.extend(
            [
                f"interface GigabitEthernet0/{iface_index}",
                f" description synthetic-device-{file_index}-section-{section_index}",
                f" ip address 10.{file_index % 250}.{section_index % 250}.1 255.255.255.0",
                f" mtu {1500 + (iface_index % 200)}",
                " state up",
                "!",
            ]
        )
    return "\n".join(lines) + "\n"


def build_archive_bytes(file_count: int, sections_per_file: int) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for file_index in range(file_count):
            archive.writestr(
                f"device-{file_index:05d}.txt",
                build_synthetic_file(file_index, sections_per_file),
            )
    buffer.seek(0)
    return buffer.getvalue()


async def run_single_benchmark_case(
    file_count: int,
    sections_per_file: int,
    poll_interval_ms: int,
) -> dict[str, object]:
    from backend.app.main import app
    from backend.app.services.parse_batch_service import ParseBatchService

    archive_bytes = build_archive_bytes(file_count=file_count, sections_per_file=sections_per_file)
    expected_tasks = file_count
    expected_archive_entries = file_count
    started_at = time.perf_counter()
    transport = httpx.ASGITransport(app=app)
    executor_probe = ParseBatchService._create_executor()
    actual_executor = type(executor_probe).__name__
    executor_probe.shutdown(wait=True, cancel_futures=True)

    async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=600.0) as client:
        response = await client.post(
            "/api/parse/batch/jobs",
            files={
                "templates_json": (None, json.dumps([{"id": "tpl-bench", "name": "Benchmark Template", "template": TEMPLATE}])),
                "files": ("benchmark.zip", archive_bytes, "application/zip"),
            },
        )
        response.raise_for_status()
        job = response.json()

        final_job = job
        poll_count = 0
        while True:
            poll_count += 1
            await asyncio.sleep(poll_interval_ms / 1000)
            status_response = await client.get(f"/api/parse/batch/jobs/{job['id']}")
            status_response.raise_for_status()
            final_job = status_response.json()
            if final_job["status"] in {"completed", "failed", "cancelled"}:
                break

        elapsed_seconds = time.perf_counter() - started_at
        page_response = await client.get(
            f"/api/parse/batch/jobs/{job['id']}/results",
            params={"offset": 0, "limit": min(200, expected_tasks)},
        )
        page_response.raise_for_status()
        page = page_response.json()

    if final_job["status"] != "completed":
        raise RuntimeError(f"Benchmark batch job did not complete successfully: {final_job}")

    if final_job["completed_tasks"] != expected_tasks:
        raise RuntimeError(f"Expected {expected_tasks} tasks, got {final_job['completed_tasks']}")

    if final_job["total_archive_entries"] != expected_archive_entries:
        raise RuntimeError(
            f"Expected {expected_archive_entries} archive entries, got {final_job['total_archive_entries']}"
        )

    sample_sizes = [len(build_synthetic_file(index, sections_per_file).encode("utf-8")) for index in range(min(file_count, 5))]
    avg_file_size_bytes = int(statistics.mean(sample_sizes)) if sample_sizes else 0

    return {
        "executor": os.getenv("TTP_BATCH_EXECUTOR", "process"),
        "actual_executor": actual_executor,
        "workers": int(os.getenv("TTP_BATCH_MAX_WORKERS", "0") or 0),
        "pending_futures": int(os.getenv("TTP_BATCH_MAX_PENDING_FUTURES", "0") or 0),
        "file_count": file_count,
        "sections_per_file": sections_per_file,
        "avg_file_size_bytes": avg_file_size_bytes,
        "elapsed_seconds": round(elapsed_seconds, 3),
        "files_per_second": round(file_count / elapsed_seconds, 2) if elapsed_seconds > 0 else 0,
        "tasks_per_second": round(expected_tasks / elapsed_seconds, 2) if elapsed_seconds > 0 else 0,
        "poll_count": poll_count,
        "job_id": final_job["id"],
        "result_preview_count": len(page["items"]),
    }


def run_suite(file_count: int, sections_per_file: int, poll_interval_ms: int) -> list[dict[str, object]]:
    results: list[dict[str, object]] = []
    for case in build_case_matrix():
        env = os.environ.copy()
        env["PYTHONPATH"] = str(REPO_ROOT)
        env["TTP_BATCH_EXECUTOR"] = env.get("TTP_BATCH_EXECUTOR", "process")
        env["TTP_BATCH_MAX_WORKERS"] = case["workers"]
        env["TTP_BATCH_MAX_PENDING_FUTURES"] = case["pending"]
        command = [
            sys.executable,
            str(Path(__file__).resolve()),
            "--mode",
            "single",
            "--file-count",
            str(file_count),
            "--sections-per-file",
            str(sections_per_file),
            "--poll-interval-ms",
            str(poll_interval_ms),
        ]
        completed = subprocess.run(
            command,
            cwd=str(REPO_ROOT),
            env=env,
            capture_output=True,
            text=True,
            check=True,
        )
        parsed = json.loads(completed.stdout.strip())
        parsed["case"] = case["name"]
        results.append(parsed)
    return results


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark batch parse throughput with synthetic zip data.")
    parser.add_argument("--mode", choices=["suite", "single"], default="suite")
    parser.add_argument("--file-count", type=int, default=300)
    parser.add_argument("--sections-per-file", type=int, default=120)
    parser.add_argument("--poll-interval-ms", type=int, default=100)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.mode == "single":
        result = asyncio.run(
            run_single_benchmark_case(
                file_count=args.file_count,
                sections_per_file=args.sections_per_file,
                poll_interval_ms=args.poll_interval_ms,
            )
        )
        print(json.dumps(result, ensure_ascii=False))
        return

    results = run_suite(
        file_count=args.file_count,
        sections_per_file=args.sections_per_file,
        poll_interval_ms=args.poll_interval_ms,
    )
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
