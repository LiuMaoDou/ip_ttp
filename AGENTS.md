# Repository Guidelines

## Project Structure & Module Organization
`ttp/` contains the core Python parser library and CLI entry point. `backend/app/` holds the FastAPI Web API, split into `routers/` and `services/`, with SQLite data stored under `backend/data/`. `frontend/src/` contains the React + TypeScript UI, with feature components under `components/`, shared state in `store/`, and API calls in `services/`. Python regression tests live in `test/pytest/`; fixture assets are under `test/pytest/assets/`. Supporting docs and design notes live in `docs/`.

## Build, Test, and Development Commands
Install Python dependencies with `poetry install` from the repo root. Run the backend with `cd backend && python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000`. Run the frontend with `cd frontend && npm install && npm run dev -- --host 127.0.0.1 --port 5173`. Use `start-dev.bat` or `./start-dev.sh` to boot both stacks together. Build the frontend with `cd frontend && npm run build`. Run the main test suite with `cd test/pytest && poetry run pytest -vv`. Run formatting/hooks with `poetry run pre-commit run --all-files`.

## Coding Style & Naming Conventions
Python follows Black formatting with a line length of 88 and 4-space indentation. Keep Python modules `snake_case`, classes `PascalCase`, and pytest files named `test_*.py`. Frontend code uses TypeScript, 2-space indentation, `PascalCase` component files such as `TemplateBuilder.tsx`, and `camelCase` hooks/utilities such as `useTextSelection.ts`. Prefer small service modules over putting API logic inside components.

## Testing Guidelines
Add or update pytest coverage for parser behavior and backend API changes in `test/pytest/`; keep fixtures close to the tests that use them. Web API tests currently use `httpx.ASGITransport` against `backend.app.main`. Run targeted tests with commands like `cd test/pytest && poetry run pytest test_web_ui_parse_api.py -vv`. Frontend Vitest settings exist in `frontend/vite.config.ts`, but the checked-in frontend test harness is incomplete, so treat frontend tests as opt-in work unless you finish wiring them.

## Commit & Pull Request Guidelines
Recent local commits use very short date-like subjects such as `0318` and `1214`, so there is no reliable descriptive convention in history. Do not copy that pattern; use short imperative subjects instead, for example `backend: fix template initialization`. PRs should describe the user-visible change, list verification commands, link related issues, and include screenshots or API examples when UI or response payloads change.
