# Template Builder Variable Editing Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add right-sidebar editing for existing Template Builder variables so users can update saved variable settings without deleting and recreating the selection.

**Architecture:** Reuse the existing `VariableModal` as a shared create/edit form, keep variable placement immutable, and wire right-sidebar variable cards to open that modal in edit mode. Add a minimal Vitest + Testing Library harness because the frontend currently has no checked-in app test setup, then drive the UI change with focused red-green tests for modal behavior, sidebar interaction, and Template Builder orchestration.

**Tech Stack:** React 18, TypeScript, Vite, Zustand, Vitest, jsdom, Testing Library

---

## File map

### Test infrastructure
- Modify: `frontend/package.json` — add the frontend test script and test-only dev dependencies.
- Modify: `frontend/package-lock.json` — record the installed test dependencies.
- Modify: `frontend/vite.config.ts` — add Vitest configuration alongside the existing Vite dev-server configuration.
- Create: `frontend/src/test/setup.ts` — register `@testing-library/jest-dom` and browser API stubs used by component tests.

### Production code
- Modify: `frontend/src/components/TemplateBuilder/VariableModal.tsx` — convert the modal into a create/edit form with normalized payload submission.
- Modify: `frontend/src/components/TemplateBuilder/VariableList.tsx` — make variable cards editable targets and preserve delete-only button behavior.
- Modify: `frontend/src/components/TemplateBuilder/TemplateBuilder.tsx` — track the active edit target, route modal submits to `addVariable()` or `updateVariable()`, and keep generated-template refresh explicit.

### Tests
- Create: `frontend/src/components/TemplateBuilder/VariableModal.test.tsx` — cover edit-mode prefilling and syntax-mode normalization.
- Create: `frontend/src/components/TemplateBuilder/VariableList.test.tsx` — cover click-to-edit and remove-button stop-propagation.
- Create: `frontend/src/components/TemplateBuilder/TemplateBuilder.test.tsx` — cover editing an existing variable without duplicating it and confirm generated output only refreshes after explicit regeneration.

### Existing references to keep open while implementing
- Reference: `docs/superpowers/specs/2026-03-16-template-builder-variable-editing-design.md`
- Reference: `frontend/src/store/useStore.ts` — existing `updateVariable()` and `generateTemplate()` behavior.

## Chunk 1: Test harness, modal behavior, and sidebar interaction

### Task 1: Add a minimal frontend test harness

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Modify: `frontend/vite.config.ts`
- Create: `frontend/src/test/setup.ts`

- [ ] **Step 1: Prove the frontend currently has no runnable test command**

Run:
```bash
cd frontend && npm test
```

Expected: npm exits non-zero with a missing `test` script error.

- [ ] **Step 2: Add the test script and install only the dependencies needed for component testing**

Run:
```bash
cd frontend && npm install -D vitest jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom
```

Then update `frontend/package.json` so the scripts section includes:
```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "lint": "eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0",
    "preview": "vite preview",
    "test": "vitest run"
  }
}
```

- [ ] **Step 3: Configure Vitest in the existing Vite config**

Update `frontend/vite.config.ts` to keep the current proxy config and use Vitest-aware config typing:
```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
  },
})
```

- [ ] **Step 4: Create the shared test setup file**

Create `frontend/src/test/setup.ts` with only the setup this feature needs:
```ts
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

beforeEach(() => {
  vi.restoreAllMocks()

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})
```

- [ ] **Step 5: Verify the harness boots cleanly before adding feature tests**

Run:
```bash
cd frontend && npm test -- --passWithNoTests
```

Expected: exit code 0 and Vitest reports that no tests were found.

- [ ] **Step 6: Commit the harness setup**

Run:
```bash
git add frontend/package.json frontend/package-lock.json frontend/vite.config.ts frontend/src/test/setup.ts
git commit -m "test: add frontend component test harness"
```

### Task 2: Drive `VariableModal` edit mode with a failing test first

**Files:**
- Create: `frontend/src/components/TemplateBuilder/VariableModal.test.tsx`
- Modify: `frontend/src/components/TemplateBuilder/VariableModal.tsx`
- Reference: `frontend/src/store/useStore.ts`

- [ ] **Step 1: Write the failing edit-mode modal test**

Create `frontend/src/components/TemplateBuilder/VariableModal.test.tsx` with focused coverage for both prefilling and normalization:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import VariableModal from './VariableModal'

const patterns = {
  WORD: { regex: '\\S+', description: 'Single word' },
  IP: { regex: '(?:[0-9]{1,3}\\.){3}[0-9]{1,3}', description: 'IPv4' },
}

describe('VariableModal', () => {
  it('prefills existing values in edit mode and clears stale filters when switching to ignore', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()

    render(
      <VariableModal
        selectedText="GigabitEthernet0/0"
        patterns={patterns}
        mode="edit"
        initialVariable={{
          name: 'interface_name',
          pattern: 'WORD',
          indicators: ['_start_'],
          syntaxMode: 'variable',
          ignoreValue: undefined,
          headersColumns: null,
        }}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    )

    expect(screen.getByDisplayValue('interface_name')).toBeInTheDocument()
    expect(screen.getByDisplayValue('WORD')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText(/syntax mode/i), 'ignore')
    await user.type(screen.getByLabelText(/ignore value/i), 'SKIP')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    expect(onConfirm).toHaveBeenCalledWith({
      name: 'interface_name',
      pattern: '',
      indicators: [],
      syntaxMode: 'ignore',
      ignoreValue: 'SKIP',
      headersColumns: null,
    })
  })
})
```

- [ ] **Step 2: Run the test and verify it fails for the missing feature**

Run:
```bash
cd frontend && npm test -- src/components/TemplateBuilder/VariableModal.test.tsx
```

Expected: FAIL because `VariableModal` does not yet accept `mode`/`initialVariable`, still uses positional `onConfirm` arguments, and the button text is still `Add Variable`.

- [ ] **Step 3: Implement the minimal create/edit modal changes**

Update `frontend/src/components/TemplateBuilder/VariableModal.tsx` so it can serve both create and edit flows:

```tsx
interface VariableFormPayload {
  name: string
  pattern: string
  indicators: string[]
  syntaxMode: VariableSyntaxMode
  ignoreValue?: string
  headersColumns: number | null
}

interface VariableModalProps {
  selectedText: string
  patterns: Record<string, Pattern>
  mode: 'create' | 'edit'
  initialVariable?: {
    name: string
    pattern: string
    indicators?: string[]
    syntaxMode?: VariableSyntaxMode
    ignoreValue?: string
    headersColumns?: number | null
  }
  onConfirm: (payload: VariableFormPayload) => void
  onCancel: () => void
}
```

Implement these rules inside the component:
- only derive default values from `selectedText` in `create` mode
- in `edit` mode, prefill from `initialVariable`
- normalize invalid input defaults before rendering:
  - unsupported `syntaxMode` => `variable`
  - unknown `pattern` => `''`
  - non-array `indicators` => `[]`
  - invalid `headersColumns` => `null`
- submit a normalized payload:
  - `variable` => clear `ignoreValue`, `headersColumns`
  - `ignore` => `pattern: ''`, `indicators: []`, preserve `ignoreValue`
  - `headers` => `pattern: ''`, `indicators: []`, preserve `headersColumns`
  - `end` => `pattern: ''`, `indicators: []`, `ignoreValue: undefined`, `headersColumns: null`
- update modal copy:
  - title `Add Variable` / `Edit Variable`
  - submit button `Add Variable` / `Save Changes`
- add `id`/`htmlFor` wiring to form controls so label-based tests and keyboard focus work reliably

- [ ] **Step 4: Run the modal test again and verify it passes**

Run:
```bash
cd frontend && npm test -- src/components/TemplateBuilder/VariableModal.test.tsx
```

Expected: PASS with 1 passing test and no TypeScript or jsdom runtime errors.

- [ ] **Step 5: Commit the modal behavior change**

Run:
```bash
git add frontend/src/components/TemplateBuilder/VariableModal.tsx frontend/src/components/TemplateBuilder/VariableModal.test.tsx
git commit -m "feat: support editing template builder variables in modal"
```

### Task 3: Drive `VariableList` edit interaction with a failing test first

**Files:**
- Create: `frontend/src/components/TemplateBuilder/VariableList.test.tsx`
- Modify: `frontend/src/components/TemplateBuilder/VariableList.tsx`

- [ ] **Step 1: Write the failing sidebar interaction test**

Create `frontend/src/components/TemplateBuilder/VariableList.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import VariableList from './VariableList'

const variable = {
  id: 'var-1',
  name: 'interface_name',
  pattern: 'WORD',
  indicators: ['_start_'],
  syntaxMode: 'variable',
  startLine: 1,
  startColumn: 1,
  endLine: 1,
  endColumn: 10,
  originalText: 'GigabitEthernet0/0',
  colorIndex: 0,
}

describe('VariableList', () => {
  it('opens edit from the variable card and keeps remove delete-only', async () => {
    const user = userEvent.setup()
    const onEditVariable = vi.fn()
    const onRemoveVariable = vi.fn()

    render(
      <VariableList
        variables={[variable]}
        groups={[]}
        onEditVariable={onEditVariable}
        onRemoveVariable={onRemoveVariable}
        onRemoveGroup={() => {}}
      />,
    )

    await user.click(screen.getByRole('button', { name: /edit variable interface_name/i }))
    expect(onEditVariable).toHaveBeenCalledWith(variable)

    await user.click(screen.getByRole('button', { name: /remove variable interface_name/i }))
    expect(onRemoveVariable).toHaveBeenCalledWith('var-1')
    expect(onEditVariable).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails for the missing edit wiring**

Run:
```bash
cd frontend && npm test -- src/components/TemplateBuilder/VariableList.test.tsx
```

Expected: FAIL because `VariableList` has no `onEditVariable` prop and the variable card is not an interactive edit target.

- [ ] **Step 3: Implement the minimal interactive sidebar behavior**

Update `frontend/src/components/TemplateBuilder/VariableList.tsx`:

```tsx
interface VariableListProps {
  variables: Variable[]
  groups: Group[]
  onEditVariable: (variable: Variable) => void
  onRemoveVariable: (id: string) => void
  onRemoveGroup: (id: string) => void
}
```

For each variable card:
- add an `onClick={() => onEditVariable(variable)}` handler on the card container
- expose a stable accessible target such as `role="button"`, `tabIndex={0}`, and `aria-label={`Edit variable ${variable.name}`}`
- add `onKeyDown` handling for `Enter` and `Space` so keyboard activation matches click activation
- keep the remove button separate and call `event.stopPropagation()` before `onRemoveVariable(variable.id)`
- add `aria-label={`Remove variable ${variable.name}`}` to the remove button

Do **not** change group-card behavior.

- [ ] **Step 4: Run the sidebar interaction test again and verify it passes**

Run:
```bash
cd frontend && npm test -- src/components/TemplateBuilder/VariableList.test.tsx
```

Expected: PASS with exactly 1 passing test.

- [ ] **Step 5: Commit the sidebar interaction change**

Run:
```bash
git add frontend/src/components/TemplateBuilder/VariableList.tsx frontend/src/components/TemplateBuilder/VariableList.test.tsx
git commit -m "feat: make template builder variables editable from sidebar"
```

## Chunk 2: Template Builder orchestration and final verification

### Task 4: Drive `TemplateBuilder` edit orchestration with a failing integration test first

**Files:**
- Create: `frontend/src/components/TemplateBuilder/TemplateBuilder.test.tsx`
- Modify: `frontend/src/components/TemplateBuilder/TemplateBuilder.tsx`
- Reference: `frontend/src/store/useStore.ts`

- [ ] **Step 1: Write the failing integration test for editing without duplication**

Create `frontend/src/components/TemplateBuilder/TemplateBuilder.test.tsx` and mock Monaco just enough for this component to mount:

```tsx
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TemplateBuilder from './TemplateBuilder'
import { useStore } from '../../store/useStore'

vi.mock('@monaco-editor/react', () => ({
  default: ({ value = '', onChange, onMount }: any) => {
    const fakeEditor = {
      addAction: vi.fn(),
      deltaDecorations: vi.fn(() => []),
      getModel: vi.fn(() => ({ getLineCount: () => 1 })),
      getSelection: vi.fn(() => null),
    }
    const fakeMonaco = {
      Range: class {},
      editor: {
        defineTheme: vi.fn(),
        setTheme: vi.fn(),
        OverviewRulerLane: { Center: 2, Left: 1 },
        InjectedTextCursorStops: { Left: 1, Right: 2 },
      },
    }

    queueMicrotask(() => onMount?.(fakeEditor, fakeMonaco))

    return (
      <textarea
        data-testid="mock-editor"
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
      />
    )
  },
}))

describe('TemplateBuilder variable editing', () => {
  beforeEach(() => {
    act(() => {
      useStore.setState({
        sampleText: 'interface GigabitEthernet0/0',
        variables: [
          {
            id: 'var-1',
            name: 'interface_name',
            pattern: 'WORD',
            indicators: [],
            syntaxMode: 'variable',
            ignoreValue: undefined,
            headersColumns: null,
            startLine: 1,
            startColumn: 11,
            endLine: 1,
            endColumn: 31,
            originalText: 'GigabitEthernet0/0',
            colorIndex: 0,
          },
        ],
        groups: [],
        generatedTemplate: '{{ interface_name | WORD }}',
        patterns: {
          WORD: { regex: '\\S+', description: 'Single word' },
          IP: { regex: '(?:[0-9]{1,3}\\.){3}[0-9]{1,3}', description: 'IPv4' },
        },
        templateName: '',
        selectedSavedTemplateId: null,
      })
    })
  })

  it('updates the existing variable and keeps generated output stale until explicit regeneration', async () => {
    const user = userEvent.setup()

    render(<TemplateBuilder />)

    await user.click(screen.getByRole('button', { name: /edit variable interface_name/i }))
    await user.clear(screen.getByLabelText(/variable name/i))
    await user.type(screen.getByLabelText(/variable name/i), 'port_name')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    const state = useStore.getState()
    expect(state.variables).toHaveLength(1)
    expect(state.variables[0].name).toBe('port_name')
    expect(state.generatedTemplate).toBe('{{ interface_name | WORD }}')

    expect(useStore.getState().generateTemplate()).toContain('{{ port_name | WORD }}')
  })
})
```

- [ ] **Step 2: Run the integration test and verify it fails because edit mode is not wired through `TemplateBuilder`**

Run:
```bash
cd frontend && npm test -- src/components/TemplateBuilder/TemplateBuilder.test.tsx
```

Expected: FAIL because `TemplateBuilder` does not pass `onEditVariable`, does not track an active edit target, and still expects the old positional modal callback.

- [ ] **Step 3: Implement the minimal orchestration changes in `TemplateBuilder`**

Update `frontend/src/components/TemplateBuilder/TemplateBuilder.tsx` with these exact responsibilities:
- read `updateVariable` from `useStore()` alongside `addVariable`
- add local state such as `const [editingVariable, setEditingVariable] = useState<Variable | null>(null)`
- replace the create-only submit handler with a shared payload handler:

```tsx
const handleVariableSubmit = useCallback((payload: VariableFormPayload) => {
  if (editingVariable) {
    const stillExists = useStore.getState().variables.some((variable) => variable.id === editingVariable.id)
    if (stillExists) {
      updateVariable(editingVariable.id, payload)
    }
    setEditingVariable(null)
    setShowModal(false)
    return
  }

  if (!currentSelection) return

  addVariable({
    ...payload,
    startLine: currentSelection.startLine,
    startColumn: currentSelection.startColumn,
    endLine: currentSelection.endLine,
    endColumn: currentSelection.endColumn,
    originalText: currentSelection.text,
  })
  setShowModal(false)
  setCurrentSelection(null)
}, [addVariable, currentSelection, editingVariable, updateVariable])
```

Then wire the render path:
- `VariableList` receives `onEditVariable={setEditingVariable}` or a small wrapper that also sets `showModal(true)`
- `VariableModal` receives:
  - `mode={editingVariable ? 'edit' : 'create'}`
  - `initialVariable={editingVariable ?? undefined}`
  - `selectedText={editingVariable?.originalText ?? currentSelection?.text ?? ''}`
  - `onConfirm={handleVariableSubmit}`
- cancel logic clears both `currentSelection` and `editingVariable`
- do **not** call `generateTemplate()` during edit submit; generated output stays stale until the user explicitly generates or saves

- [ ] **Step 4: Run the integration test plus the earlier focused tests and verify they all pass**

Run:
```bash
cd frontend && npm test -- src/components/TemplateBuilder/TemplateBuilder.test.tsx src/components/TemplateBuilder/VariableModal.test.tsx src/components/TemplateBuilder/VariableList.test.tsx
```

Expected: PASS with 3 passing test files and 0 failures.

- [ ] **Step 5: Commit the Template Builder wiring change**

Run:
```bash
git add frontend/src/components/TemplateBuilder/TemplateBuilder.tsx frontend/src/components/TemplateBuilder/TemplateBuilder.test.tsx
git commit -m "feat: wire template builder sidebar variable editing"
```

### Task 5: Run complete verification and a manual smoke test

**Files:**
- Reference only: `frontend/src/components/TemplateBuilder/TemplateBuilder.tsx`
- Reference only: `frontend/src/components/TemplateBuilder/VariableModal.tsx`
- Reference only: `frontend/src/components/TemplateBuilder/VariableList.tsx`

- [ ] **Step 1: Run the full frontend test suite**

Run:
```bash
cd frontend && npm test
```

Expected: PASS with all frontend test files green.

- [ ] **Step 2: Run the production build**

Run:
```bash
cd frontend && npm run build
```

Expected: Vite build completes successfully with exit code 0.

- [ ] **Step 3: Manually smoke-test the feature in the running app**

Run the app if it is not already running:
```bash
cd backend && python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
cd frontend && npm run dev -- --host 127.0.0.1 --port 5173
```

Manual checklist:
- paste sample input into the `Sample Input` editor
- create one variable from a text selection
- click that variable in the right sidebar
- confirm the edit modal opens prefilled with the current values
- change the variable name or syntax mode and save
- confirm the sidebar card updates immediately
- confirm the `Generated Template` pane does **not** change until you click `Generate` or `Save`
- trigger `Generate` or `Save` and confirm the generated syntax reflects the edited variable
- confirm clicking the remove button still deletes without opening the modal

- [ ] **Step 4: Commit the verified feature**

Run:
```bash
git add frontend/src/components/TemplateBuilder/VariableModal.tsx frontend/src/components/TemplateBuilder/VariableList.tsx frontend/src/components/TemplateBuilder/TemplateBuilder.tsx frontend/src/components/TemplateBuilder/VariableModal.test.tsx frontend/src/components/TemplateBuilder/VariableList.test.tsx frontend/src/components/TemplateBuilder/TemplateBuilder.test.tsx frontend/package.json frontend/package-lock.json frontend/vite.config.ts frontend/src/test/setup.ts
git commit -m "feat: add editable template builder variables"
```
