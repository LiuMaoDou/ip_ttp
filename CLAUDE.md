# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This repository contains two related parts:

1. **TTP core library** (`ttp/`) — the Python parser that turns template syntax into regex-driven parsing results.
2. **TTP Web UI** (`backend/` + `frontend/`) — a FastAPI + React app for building templates interactively and testing parse output.

Most automated tests in this repository target the **core library** under `test/pytest/`.

## Common Development Commands

### Core Python library (repo root)

```bash
# Install core + dev dependencies
poetry install

# Install optional runtime extras used by some tests/features
poetry install -E full

# Run full test suite (must run from test/pytest)
cd test/pytest && poetry run pytest -vv

# Run a single test file
cd test/pytest && poetry run pytest test_misc.py -vv

# Run one test case
cd test/pytest && poetry run pytest test_misc.py::test_quick_parse -vv

# Run pre-commit hooks
poetry run pre-commit run --all-files

# Format core package
poetry run black --line-length=88 ttp/

# CLI entrypoint exposed by pyproject
poetry run ttp --help
```

### Backend API (`backend/`)

```bash
# Install backend-specific deps
cd backend && pip install -r requirements.txt

# Run FastAPI dev server
cd backend && python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### Frontend UI (`frontend/`)

```bash
# Install dependencies
cd frontend && npm install

# Run Vite dev server
cd frontend && npm run dev -- --host 127.0.0.1 --port 5173

# Production build
cd frontend && npm run build

# Lint script exists, but currently no project ESLint config is checked in
cd frontend && npm run lint
```

### Run full web stack

```bash
# Linux/macOS
./start-dev.sh

# Windows
start-dev.bat
```

## High-Level Architecture

### 1) Core parser engine (`ttp/`)

- `ttp/ttp.py` is the main orchestration entrypoint.
- The `ttp` class handles:
  - template loading
  - input loading
  - parse execution
  - result shaping via `result()`
- `result()` supports multiple structures (`list`, `dictionary`, `flat_list`) and can also run output formatters/returners such as `csv`.
- Parsing can run in single-process or multi-process mode depending on aggregate input size and count.

Template execution flow is:
1. Load template(s) and input(s)
2. Build regexes from variables and tags
3. Parse text into group/match structures
4. Form the final nested result tree
5. Optionally run output formatters/returners

### 2) Lazy function/plugin system (`_ttp_` dictionary)

- TTP discovers functions by scanning module directories and registers lazy wrappers in `_ttp_`.
- Functions are imported on first use rather than eagerly at startup.
- Function categories map to directories such as:
  - `match/`
  - `group/`
  - `input/`
  - `output/`
  - `formatters/`
  - `returners/`
  - `variable/`
  - `lookup/`
  - `utils/`
- Cache file: `ttp_dict_cache.pickle` (path controlled by `TTPCACHEFOLDER`).
- Template-facing aliases are defined with `_name_map_` inside module files.

### 3) FastAPI backend (`backend/app`)

- `app/main.py` sets up FastAPI, CORS, and router registration.
- `app/routers/parse.py` exposes:
  - `POST /api/parse` — parse raw text with a template; optional `name` wraps the template in `<group name="...">`
  - `POST /api/parse/file` — parse uploaded file content
  - `GET /api/patterns` — built-in pattern catalog used by the frontend
- `app/services/ttp_service.py` is the backend integration point to the core parser:
  - runs `ttp(...).parse()`
  - normalizes the nested Python result shape returned by TTP into the simpler JSON shape used by the UI
  - also returns `csv_result` using TTP's native `csv` formatter so frontend CSV downloads come from TTP output, not client-side reconstruction
- The backend is stateless; there is no database or server-side template persistence.

### 4) React frontend (`frontend/src`)

- `App.tsx` is a 2-tab shell:
  - **Template Builder**
  - **Test & Results**
- On startup, `App.tsx` fetches `/api/patterns` and shows backend connection status in the header.
- Global app state lives in `store/useStore.ts` using Zustand with `persist` storage key `ttp-web-storage`.

#### Template Builder flow

- `components/TemplateBuilder/TemplateBuilder.tsx` owns Monaco editor integration and visual decorations.
- Right-click / selection flows open modal-driven creation for variables and groups.
- Variable metadata stored in Zustand includes:
  - name
  - pattern
  - indicator list
  - syntax mode (`variable`, `ignore`, `headers`, `end`)
  - optional `ignoreValue` and `headersColumns`
- `useStore.ts` centralizes final template generation logic. The UI captures selections, but `generateTemplate()` is what converts variables/groups into final TTP template text.
- Saved templates are client-side only and persisted in browser storage.

#### Test & Results flow

- `components/TestResults/TestResults.tsx` lets users test one or more selected templates against one or more selected files, or manual text when no files are present.
- The page keeps both template selection and file selection state; selected test file IDs are persisted in Zustand so refreshes preserve the last file selection.
- Results are stored as `FileParseResult[]`, one entry per template/input combination.
- Each result includes:
  - normalized JSON parse output (`result`)
  - backend-produced formatter output (`csvResult`)
- Download actions support:
  - per-result JSON
  - per-result CSV
  - ZIP of all JSON results
  - ZIP of all CSV results

### 5) API boundary (`frontend/src/services/api.ts`)

- Axios base URL is `/api`.
- Development proxy is configured in `frontend/vite.config.ts`.
- Current Vite proxy target is `http://localhost:8000`, which must match the backend dev server port.

## Important Repo-Specific Notes

- **Test working directory matters**: core tests assume execution from `test/pytest/`; fixture paths are relative to that directory.
- **Frontend commands must run from `frontend/`**: running `npm run dev` from repo root fails because `package.json` is under `frontend/`.
- **Vite proxy / backend port alignment matters**: frontend development expects `/api` to proxy to `http://localhost:8000`.
- **Frontend lint is not currently wired up completely**: the `npm run lint` script exists, but no project ESLint config is checked in outside `node_modules`, so lint currently fails for configuration reasons rather than app code errors.
- **When adding new TTP functions**:
  - place the module in the correct `ttp/<scope>/` directory
  - define `_name_map_` if the template-facing name differs from the Python function name
  - if lazy discovery looks stale, remove `ttp_dict_cache.pickle` or override `TTPCACHEFOLDER`
- **No Cursor/Copilot rule files were found**: there is no `.cursorrules`, `.cursor/rules/`, or `.github/copilot-instructions.md` in this repository.
