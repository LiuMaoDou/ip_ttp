# Template Builder right-sidebar variable editing design

## Summary

Allow users to edit an existing variable from the Template Builder right sidebar instead of deleting and recreating it. The edit flow will reuse the existing variable modal so users can update all currently supported variable fields while keeping the original selection range anchored in the sample input.

## Context

The current Template Builder flow supports creating variables from a Monaco selection and listing them in the right sidebar, but the sidebar only allows removal.

Relevant code paths:

- `frontend/src/components/TemplateBuilder/TemplateBuilder.tsx`
- `frontend/src/components/TemplateBuilder/VariableList.tsx`
- `frontend/src/components/TemplateBuilder/VariableModal.tsx`
- `frontend/src/store/useStore.ts`

Today:

- variable creation is handled from the editor context menu and stored in Zustand
- the right sidebar renders variable metadata plus a remove button
- `updateVariable()` already exists in the store, but the UI does not expose an edit action

## Goal

Add an edit workflow in the right sidebar so a user can click an existing variable and modify its configuration without recreating the selection.

## Non-goals

- editing group definitions from the right sidebar
- changing a variable's selected text range from the sidebar
- introducing inline editing inside the sidebar cards
- redesigning the broader Template Builder layout

## Chosen approach

Use the existing `VariableModal` as a shared create/edit form.

From the right sidebar, clicking a variable card will open the modal in edit mode with that variable's current values prefilled. Saving the modal will update the existing variable via `updateVariable()` instead of creating a new variable.

This keeps the interaction model consistent with the existing create flow, minimizes UI sprawl in the sidebar, and avoids duplicating syntax-building logic.

## UX design

### Sidebar behavior

- Variable cards in the right sidebar become clickable edit targets.
- Clicking a variable card opens the variable modal in edit mode.
- The existing remove button remains available on the card.
- Clicking the remove button must not also trigger edit mode.
- Group cards remain unchanged and continue to support removal only.
- There is no separate stale-state badge or warning for the Generated Template pane after edits; unchanged generated output until the next explicit generation is intentional for this feature.

### Edit modal behavior

The existing modal becomes a shared form for both create and edit operations.

In edit mode:

- the modal title changes from `Add Variable` to `Edit Variable`
- the submit button text changes from `Add Variable` to `Save Changes`
- all current variable configuration fields are editable:
  - variable name
  - pattern
  - indicators
  - syntax mode
  - syntax-mode-specific fields such as `ignoreValue` and `headersColumns`
- the syntax preview continues to reflect the current field values in real time
- the selected/original text is shown for context, but the edit flow does not change the stored selection coordinates

### Generated template refresh behavior

Editing a variable updates sidebar data and Monaco decorations immediately because both read directly from the current store state.

The Generated Template pane remains a cached snapshot of the last explicit generation. Editing a variable does not auto-regenerate `generatedTemplate`. To refresh that pane, the user must trigger the existing explicit generation path again, such as `Generate` or any save flow that already calls `generateTemplate()`.

This keeps the feature scoped to variable editing and avoids introducing a new reactive template-generation behavior.

## Data model and state rules

The edit flow updates only variable configuration, not variable identity or selection placement.

### Editable fields

- `name`
- `pattern`
- `indicators`
- `syntaxMode`
- `ignoreValue`
- `headersColumns`

### Syntax-mode normalization rules

Submitted edit payloads are normalized to match the currently selected syntax mode.

- `variable`
  - preserve `name`, `pattern`, and `indicators`
  - clear `ignoreValue`
  - set `headersColumns` to `null`
- `ignore`
  - preserve `ignoreValue`
  - clear `headersColumns`
  - set `pattern` to an empty string
  - set `indicators` to an empty array so stale variable-mode filters are not retained
- `headers`
  - preserve `headersColumns`
  - clear `ignoreValue`
  - set `pattern` to an empty string
  - set `indicators` to an empty array
- `end`
  - clear `ignoreValue`
  - set `headersColumns` to `null`
  - set `pattern` to an empty string
  - set `indicators` to an empty array

If persisted values are invalid when edit mode opens, the modal normalizes them before display:

- unsupported `syntaxMode` falls back to `variable`
- unknown `pattern` falls back to an empty string
- missing or non-array `indicators` falls back to `[]`
- non-positive or non-numeric `headersColumns` falls back to `null`

This prevents stale mode-specific data from surviving because `updateVariable()` merges fields.

### Immutable during edit

- `id`
- `startLine`
- `startColumn`
- `endLine`
- `endColumn`
- `originalText`
- `colorIndex`

Keeping these fields fixed preserves the current Monaco decoration behavior and ensures generated template replacements still target the same source range.

## Component-level changes

### `frontend/src/components/TemplateBuilder/TemplateBuilder.tsx`

Add local UI state for the variable currently being edited.

Responsibilities:

- open the modal in create mode when a text selection is turned into a new variable
- open the modal in edit mode when a right-sidebar variable is clicked
- call `addVariable()` for create mode
- call `updateVariable()` for edit mode
- close and clear edit state after save or cancel

### `frontend/src/components/TemplateBuilder/VariableList.tsx`

Update the variable list to support an edit callback.

Responsibilities:

- accept an `onEditVariable(variable)` prop
- make variable cards clickable
- preserve existing display of syntax mode, pattern, indicators, original text, and source location
- stop event propagation from the remove button so delete does not trigger edit

Group rendering stays unchanged.

### `frontend/src/components/TemplateBuilder/VariableModal.tsx`

Refactor the modal into a reusable create/edit form.

Responsibilities:

- accept mode metadata such as `mode: 'create' | 'edit'`
- accept initial values for edit mode
- derive default values from `selectedText` only for create mode
- prefill from the existing variable for edit mode
- keep the existing syntax-mode-specific enable/disable behavior
- normalize submitted values based on the selected syntax mode
- submit the same normalized payload shape for both modes so the parent can decide whether to create or update

Modal contract:

- props include:
  - `selectedText: string`
  - `patterns: Record<string, Pattern>`
  - `mode: 'create' | 'edit'`
  - `initialVariable?: Pick<Variable, 'name' | 'pattern' | 'indicators' | 'syntaxMode' | 'ignoreValue' | 'headersColumns'>`
  - `onConfirm(payload)`
  - `onCancel()`
- submitted payload shape:
  - `name: string`
  - `pattern: string`
  - `indicators: string[]`
  - `syntaxMode: VariableSyntaxMode`
  - `ignoreValue?: string`
  - `headersColumns: number | null`

Migration rule:

- this feature migrates `VariableModal` atomically to the payload-based callback and updates its single current caller in `TemplateBuilder` within the same change
- no compatibility wrapper for the old positional callback is needed because `TemplateBuilder` is the only in-repo caller

Important rules:

- create-mode initialization must not overwrite edit-mode values when the modal opens for an existing variable
- `onConfirm` returns normalized values only and never returns immutable placement fields such as line, column, id, original text, or color index

### `frontend/src/store/useStore.ts`

`updateVariable()` already exists and should remain the single store mutation used for edits.

No new persistent data shape is required.

## Data flow

### Create flow

1. User selects text in the sample input editor.
2. User opens the existing add-variable action.
3. `TemplateBuilder` opens `VariableModal` in create mode.
4. On submit, `addVariable()` appends a new variable.

### Edit flow

1. User clicks a variable card in the right sidebar.
2. `TemplateBuilder` stores the selected variable as the active edit target.
3. `TemplateBuilder` opens `VariableModal` in edit mode with the variable's current values.
4. On submit, `TemplateBuilder` checks that the target variable still exists in store. If it does, it calls `updateVariable(variable.id, updates)`. If it no longer exists, the modal closes with no mutation and no user-visible error message.
5. The sidebar and Monaco decorations reflect the updated variable configuration immediately from the store.
6. The Generated Template pane is refreshed only on the next explicit generation action.

## Error handling and edge cases

- Delete clicks must not also open the edit modal.
- Edit mode must preserve mode-specific values correctly when switching between syntax modes in the modal.
- If a variable uses non-default syntax modes (`ignore`, `headers`, `end`), the modal must prefill the corresponding fields correctly.
- If a stored variable was created before newer optional fields existed, edit-mode defaults should safely fall back to empty values rather than crashing.
- If the target variable disappears before submit, the modal closes without mutation.
- If the modal is cancelled, no store mutation occurs.

## Testing expectations

Implementation should follow TDD.

Current repo state: the frontend package does not currently define a test script or checked-in frontend test harness in `frontend/package.json`, and there are no app-level frontend test files outside dependencies. For this feature, the required test scope is:

- add a minimal frontend test harness only if needed to test this feature
- prefer narrowly scoped component/integration tests over broad end-to-end setup

Required coverage:

- a `VariableModal` component test covering edit-mode prefilling and syntax-mode normalization
- a `VariableList` interaction test covering card click to edit and remove-button stop-propagation
- a `TemplateBuilder` integration test covering updating an existing variable rather than creating a duplicate
- a store- or integration-level assertion that generated syntax reflects edits after the next explicit generation action

Before production changes, add focused tests that cover:

- opening edit mode from the right sidebar for an existing variable
- prefilled modal state for each supported field
- saving edits updates the existing variable instead of creating a second variable
- delete button interaction remains delete-only
- generated syntax changes correctly after edits across supported syntax modes

## Why this design

This approach stays within the current architecture:

- `TemplateBuilder` already coordinates modal visibility and store actions
- `VariableModal` already owns the field and syntax-preview logic we need
- `useStore.ts` already exposes `updateVariable()`

That makes the feature small, local, and aligned with the current code structure instead of introducing a second editing surface or new persistence rules.

## Acceptance criteria

The feature is complete when:

1. A user can click a variable in the right sidebar and open an edit modal.
2. The modal is prefilled with the selected variable's current configuration.
3. The user can modify all current variable fields supported by the create flow.
4. Saving updates the same variable record rather than creating a new one.
5. Removing a variable from the sidebar still works and does not trigger edit mode.
6. Existing group behavior is unchanged.
