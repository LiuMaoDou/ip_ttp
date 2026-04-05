# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This repository contains two related parts:

1. **TTP core library** (`ttp/`) — the Python parser that turns template syntax into regex-driven parsing results.
2. **TTP Web UI** (`backend/` + `frontend/`) — a FastAPI + React app for building templates interactively, testing parse output, and persisting saved templates.

Most automated tests still target the **core library** under `test/pytest/`, but that directory also contains the Web UI backend regression tests. The top-level `README.md` is primarily about the core parser library and examples; the Web UI workflow is defined mostly by `backend/`, `frontend/`, and the Web UI pytest files.

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

# Run Web UI backend regression tests
cd test/pytest && poetry run pytest test_web_ui_template_service.py -vv
cd test/pytest && poetry run pytest test_web_ui_csv_output.py -vv
cd test/pytest && poetry run pytest test_web_ui_parse_api.py -vv
cd test/pytest && poetry run pytest test_web_ui_generation_api.py -vv

# Run one Web UI backend test case
cd test/pytest && poetry run pytest test_web_ui_generation_api.py::test_render_generation_files -vv

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

# Run backend with a custom SQLite database path
cd backend && TTP_WEB_DB_PATH=./data/ttp_web.dev.db python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

The backend imports the local `ttp/` package via `app/services/ttp_service.py`, so running from `backend/` should still exercise the checked-out parser code instead of a globally installed package.

### Frontend UI (`frontend/`)

```bash
# Install dependencies
cd frontend && npm install

# Run Vite dev server
cd frontend && npm run dev -- --host 127.0.0.1 --port 5173

# Production build
cd frontend && npm run build

# Preview production build
cd frontend && npm run preview

# Lint script exists, but there is no checked-in ESLint config in the repo
cd frontend && npm run lint

# There is currently no frontend test script in package.json.
# vite.config.ts contains Vitest settings, but src/test/setup.ts is missing
# and no frontend test files are checked in yet.
```

### Run full web stack

```bash
# Linux/macOS
./start-dev.sh

# Windows
start-dev.bat
```

The startup scripts now fail fast if `8000` or `5173` is already occupied, and they verify backend readiness before launching the frontend. This avoids the frontend silently connecting to a stale backend process and showing `Backend offline`.

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

- `app/main.py` sets up FastAPI, CORS, router registration, and startup initialization for template storage.
- `app/routers/parse.py` exposes:
  - `POST /api/parse` — parse raw text with a template; optional `name` wraps the template in `<group name="...">`
  - `POST /api/parse/file` — parse uploaded file content
  - `GET /api/patterns` — built-in pattern catalog used by the frontend
  - `POST /api/parse/batch/jobs` — submit a background batch parse job (multiple files × multiple templates)
  - `GET /api/parse/batch/jobs/{job_id}` — poll job status
  - `POST /api/parse/batch/jobs/{job_id}/cancel` — cancel a running job
  - `GET /api/parse/batch/jobs/{job_id}/results` — paginated result rows
  - `GET /api/parse/batch/jobs/{job_id}/artifacts/{artifact_name}` — download result artifacts (ZIP, XLSX)
- `app/services/parse_batch_service.py` runs batch jobs in a background thread pool with a `ProcessPoolExecutor` for CPU-bound parsing; job state is held in-process (not persisted to SQLite). Env vars `TTP_BATCH_MAX_WORKERS` and `TTP_BATCH_MAX_JOBS` control concurrency.
- `app/routers/templates.py` exposes saved-template CRUD under `/api/templates`:
  - `GET /api/templates`
  - `POST /api/templates`
  - `PUT /api/templates/{template_id}`
  - `DELETE /api/templates/{template_id}`
- `app/routers/generation.py` exposes config-generation template CRUD and batch rendering under `/api/generation`:
  - `GET /api/generation/templates`
  - `POST /api/generation/templates`
  - `PUT /api/generation/templates/{template_id}`
  - `DELETE /api/generation/templates/{template_id}`
  - `POST /api/generation/render`
- `app/services/ttp_service.py` is the backend integration point to the core parser:
  - prepends the repository root to `sys.path` before importing `ttp`, so backend runs from `backend/` still use the local `ttp/` package rather than any globally installed `ttp`
  - runs `ttp(...).parse()`
  - normalizes the nested Python result shape returned by TTP into the simpler JSON shape used by the UI
  - returns `csv_result` using TTP output machinery so frontend CSV downloads come from backend-generated formatter output
  - returns `checkup_csv_result`, a backend-generated per-line coverage CSV built from the original input text plus accepted parser match spans
- `app/services/template_service.py` is the SQLite persistence layer for saved templates:
  - uses Python stdlib `sqlite3` only
  - initializes schema on startup
  - stores `variables` and `groups` as JSON blobs in a single `templates` table
  - supports `TTP_WEB_DB_PATH`; default DB path is `backend/data/ttp_web.db`
- `app/services/generation_service.py` handles a second SQLite-backed persistence flow for saved config-generation templates plus rendering logic:
  - stores `source_templates` and `bindings` JSON in a `generation_templates` table in the same SQLite database path
  - `ConfigGenerationService` validates uploaded JSON by required template aliases and renders generation templates from namespaced payloads
  - bindings are persisted as editor coordinates plus original text and are applied back onto the saved generation template text before render
  - Jinja2 sandbox rendering is used when available; otherwise a limited `{{ data.path }}` placeholder renderer is used
- `app/routers/template_library.py` exposes shared vendor/category management under `/api/template-library`:
  - `GET/POST /api/template-library/vendors` — list or create vendors (shared across parse and generation templates)
  - `PUT/DELETE /api/template-library/vendors/{vendor_name}` — rename or delete a vendor
  - `GET/POST /api/template-library/{template_kind}/categories` — list or create categories for `parse` or `generation` kind
  - `PUT/DELETE /api/template-library/{template_kind}/categories/{category_id}` — update or delete a category
- `app/services/template_directory_service.py` manages the `vendors`, `template_categories`, and `generation_categories` tables in the same SQLite database. `DEFAULT_VENDOR` is `"Unassigned"`. Templates and generation templates each carry `vendor` and `category_path` fields referencing this directory.
- The backend has no general application database beyond the SQLite file used for saved Web UI templates.

### 4) React frontend (`frontend/src`)

- `App.tsx` is a 3-tab shell:
  - **Template Builder**
  - **Test & Results**
  - **Config Generation**
- On startup, `App.tsx` fetches `/api/patterns`, `/api/templates`, `/api/generation/templates`, and `/api/template-library/vendors` plus both category lists, and shows backend connection status in the header.
- Global app state lives in `store/useStore.ts` using Zustand with `persist` storage key `ttp-web-storage`.
- `components/TemplateDirectoryTree.tsx` renders the vendor/category sidebar used in both the Template Builder and Config Generation tabs. It drives the Move Template modal and communicates with `/api/template-library` to create, rename, and delete vendors and categories.

#### Template Builder flow

- `components/TemplateBuilder/TemplateBuilder.tsx` owns Monaco editor integration, visual decorations, and Monaco-backed runtime range tracking.
- Right-click / selection flows open modal-driven creation for variables and groups.
- The Sample Input editor is intentionally editable after annotations are added: Monaco tracking decorations move variable/group ranges during edits, then sync the updated coordinates back into Zustand via `syncVariableRanges()` / `syncGroupRanges()`.
- Variable metadata stored in Zustand includes:
  - name
  - pattern
  - indicator list
  - syntax mode (`variable`, `ignore`, `headers`, `end`)
  - optional `ignoreValue` and `headersColumns`
- `useStore.ts` centralizes final template generation logic. The UI captures selections, but `generateTemplate()` is the source of truth for converting variables/groups into final TTP template text.
- `generateTemplate()` now defensively skips invalid or out-of-bounds annotations; multiline variables are treated as invalid rather than being patched into the current single-line replacement logic.
- Saved templates are **backend-backed** now:
  - `savedTemplates` are fetched from `/api/templates`
  - `selectedSavedTemplateId` tracks which saved template is currently loaded
  - `saveTemplate()` does `POST` for new templates and `PUT` for the selected saved template
  - `loadTemplate()` copies a saved template into the local draft state
- Unsaved draft/editor state stays in browser storage via Zustand `persist`; saved templates do not.

#### Test & Results flow

- `components/TestResults/TestResults.tsx` lets users test one or more selected templates against one or more selected files, or manual text when no files are present.
- The page keeps both template selection and file selection state; selected test file IDs are persisted in Zustand so refreshes preserve the last file selection.
- Results are stored as `FileParseResult[]`, one entry per template/input combination.
- Each result includes:
  - normalized JSON parse output (`result`)
  - backend-produced formatter output (`csvResult`)
  - backend-produced per-line coverage output (`checkupCsvResult`)
- Download actions support:
  - per-result JSON
  - per-result CSV
  - ZIP of all JSON results
  - ZIP of all CSV results
  - ZIP of all Checkup CSV results
- Checkup downloads now use the top-level bulk download flow in `TestResults.tsx`; each archive entry is still named per template/input combination using the `.checkup.csv` suffix.

#### Config Generation flow

- `components/ConfigGeneration/` is the third major UI flow for building output configs from previously parsed template data.
- The frontend stores config-generation draft text, selected source templates, bindings, uploaded JSON files, and render results in the same Zustand store used by the other tabs.
- Saved generation templates are backend-backed via `/api/generation/templates`; unsaved generation editor state still lives in persisted browser storage.
- Generation bindings persist Monaco-style text ranges plus a structured reference (`templateAlias`, `groupPath`, `variableName`, `selector`, `expression`). The backend re-applies those bindings onto saved template text before rendering.
- Render uploads are JSON files posted to `/api/generation/render`; the backend expects namespaced data keyed by source-template alias, or under a top-level `templates` object.
- The frontend can generate directly from the current draft without saving first; saving generation templates is an explicit persistence action, not a prerequisite for render.

### 5) API boundary (`frontend/src/services/api.ts`)

- Axios base URL is `/api`.
- Development proxy is configured in `frontend/vite.config.ts`.
- Current Vite proxy target is `http://localhost:8000`; if this is changed for debugging, keep it aligned with the backend dev server port.
- Backend responses stay in `snake_case`; `frontend/src/services/api.ts` maps them into the frontend's `camelCase` types.

## Important Repo-Specific Notes

- **Test working directory matters**: core tests assume execution from `test/pytest/`; fixture paths are relative to that directory.
- **Frontend commands must run from `frontend/`**: running `npm run dev` or `npm run build` from repo root fails because `package.json` is under `frontend/`.
- **Vite proxy / backend port alignment matters**: frontend development expects `/api` to proxy to whatever backend port is currently configured in `frontend/vite.config.ts`. The default project target is `http://localhost:8000`, but this may be temporarily changed during debugging.
- **Saved template persistence split**:
  - backend SQLite is the source of truth for `savedTemplates`
  - browser localStorage still holds the current draft/editor state and other UI convenience state
  - switching browsers/machines preserves saved templates only if they were saved to backend
- **Template DB path**: set `TTP_WEB_DB_PATH` to point the Web UI at a different SQLite file; useful for tests and isolated local runs.
- **Web UI backend tests**:
  - `test/pytest/test_web_ui_template_service.py` covers SQLite CRUD and `/api/templates`
  - `test/pytest/test_web_ui_csv_output.py` covers `TTPService` CSV and Checkup CSV behavior
  - `test/pytest/test_web_ui_parse_api.py` covers `/api/parse` response mapping, including `checkup_csv_result`
  - `test/pytest/test_web_ui_generation_api.py` covers generation template CRUD and `/api/generation/render`
- **Template Builder coordinate sync matters**: variable/group coordinates are still the persisted contract for saved templates and `generateTemplate()`, but `TemplateBuilder.tsx` relies on Monaco tracking decorations to keep those coordinates aligned while users edit sample text. If you change annotation behavior, preserve that sync path instead of making generation depend directly on live Monaco selection state.
- **Config generation bindings are also coordinate-based**: `generationBindings` persist text ranges and original text from the editor. Backend rendering validates and reapplies those ranges before templating, so changes to frontend binding capture must stay aligned with `ConfigGenerationService._selection_to_offsets()` and `_apply_bindings()`.
- **Frontend lint is not currently wired up completely**: the `npm run lint` script exists, but there is no checked-in ESLint config in the repository, so lint currently fails for configuration reasons rather than app code errors.
- **Frontend tests exist but wiring is partial**: `frontend/src/components/TestResults/TestResults.test.tsx` uses Vitest + Testing Library. There is still no `test` script in `frontend/package.json` and `setupFiles` in `vite.config.ts` points at `frontend/src/test/setup.ts`, which is absent — run tests via `cd frontend && npx vitest` directly for now.
- **When adding new TTP functions**:
  - place the module in the correct `ttp/<scope>/` directory
  - define `_name_map_` if the template-facing name differs from the Python function name
  - if lazy discovery looks stale, remove `ttp_dict_cache.pickle` or override `TTPCACHEFOLDER`
- **No Cursor/Copilot rule files were found**: there is no `.cursorrules`, `.cursor/rules/`, or `.github/copilot-instructions.md` in this repository.
