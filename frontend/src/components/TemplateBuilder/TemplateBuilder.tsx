import { useRef, useState, useCallback, useEffect, type ChangeEvent } from 'react'
import Editor, { OnMount } from '@monaco-editor/react'
import type { editor, IRange, IDisposable } from 'monaco-editor'
import { saveAs } from 'file-saver'
import {
  createCategory as createCategoryRequest,
  createTemplate as createTemplateRequest,
  createVendor as createVendorRequest,
  updateTemplate as updateTemplateRequest,
  type SavedTemplatePayload,
  type TemplateCategory
} from '../../services/api'
import { useStore, getVariableColor, type Group, type TemplateSaveSource, type Variable, type VariableSyntaxMode } from '../../store/useStore'
import TemplateDirectoryTree from '../TemplateDirectoryTree'
import VariableModal from './VariableModal'
import GroupModal from './GroupModal'
import VariableList from './VariableList'
import ContextMenu from './ContextMenu'

const VARIABLE_COLORS = Array.from({ length: 12 }, (_, index) => getVariableColor(index))
const EDITOR_FONT_FAMILY = "'JetBrains Mono', 'Consolas', 'Microsoft YaHei', monospace"

// Current selection state for the modal
interface CurrentSelection {
  text: string
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
}

// Group selection state
interface GroupSelection {
  text: string
  startLine: number
  endLine: number
}

interface SampleContextMenuState extends CurrentSelection {
  x: number
  y: number
}

interface TemplateLibraryImport {
  vendors: string[]
  categories: Array<{ vendor: string; path: string[] }>
  templates: Array<{ id?: string; payload: SavedTemplatePayload }>
}

interface MonacoRangeShape {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

function isRangeOrdered(range: MonacoRangeShape): boolean {
  if (range.startLineNumber < range.endLineNumber) {
    return true
  }

  if (range.startLineNumber > range.endLineNumber) {
    return false
  }

  return range.startColumn <= range.endColumn
}

function isRangeWithinModel(model: editor.ITextModel, range: MonacoRangeShape): boolean {
  const lineCount = model.getLineCount()
  if (
    range.startLineNumber < 1 ||
    range.endLineNumber < 1 ||
    range.startLineNumber > lineCount ||
    range.endLineNumber > lineCount ||
    range.startColumn < 1 ||
    range.endColumn < 1 ||
    !isRangeOrdered(range)
  ) {
    return false
  }

  const startMaxColumn = model.getLineMaxColumn(range.startLineNumber)
  const endMaxColumn = model.getLineMaxColumn(range.endLineNumber)

  return range.startColumn <= startMaxColumn && range.endColumn <= endMaxColumn
}

function isCollapsedRange(range: MonacoRangeShape): boolean {
  return (
    range.startLineNumber === range.endLineNumber &&
    range.startColumn === range.endColumn
  )
}

function getEntityColorIndex(colorIndex: number | undefined, fallbackIndex: number): number {
  return typeof colorIndex === 'number' && Number.isInteger(colorIndex) ? colorIndex : fallbackIndex
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getStringField(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string') {
      return value
    }
  }

  return ''
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean)
    : []
}

function toRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function normalizeImportVendor(value: unknown): string | null {
  if (typeof value === 'string') {
    const vendor = value.trim()
    return vendor || null
  }

  if (isRecord(value)) {
    const vendor = getStringField(value, 'name').trim()
    return vendor || null
  }

  return null
}

function normalizeImportCategory(value: unknown): { vendor: string; path: string[] } | null {
  if (!isRecord(value)) {
    return null
  }

  const vendor = getStringField(value, 'vendor').trim() || 'Unassigned'
  const path = toStringArray(value.path)
  if (path.length === 0) {
    return null
  }

  return { vendor, path }
}

function normalizeImportTemplate(value: unknown): { id?: string; payload: SavedTemplatePayload } | null {
  if (!isRecord(value)) {
    return null
  }

  const name = getStringField(value, 'name').trim()
  if (!name) {
    return null
  }

  return {
    id: getStringField(value, 'id').trim() || undefined,
    payload: {
      name,
      description: getStringField(value, 'description'),
      vendor: getStringField(value, 'vendor').trim() || 'Unassigned',
      categoryPath: toStringArray(value.categoryPath ?? value.category_path),
      sampleText: getStringField(value, 'sampleText', 'sample_text'),
      variables: toRecordArray(value.variables),
      groups: toRecordArray(value.groups),
      generatedTemplate: getStringField(value, 'generatedTemplate', 'generated_template')
    }
  }
}

function parseTemplateLibraryImport(content: string): TemplateLibraryImport | null {
  let parsed: unknown

  try {
    parsed = JSON.parse(content)
  } catch {
    return null
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.templates)) {
    return null
  }

  const templates = parsed.templates
    .map(normalizeImportTemplate)
    .filter((template): template is { id?: string; payload: SavedTemplatePayload } => template !== null)

  if (templates.length === 0) {
    return null
  }

  const vendors = [
    ...(Array.isArray(parsed.vendors) ? parsed.vendors.map(normalizeImportVendor) : []),
    ...templates.map((template) => template.payload.vendor)
  ].filter((vendor): vendor is string => Boolean(vendor))

  const categories = [
    ...(Array.isArray(parsed.categories) ? parsed.categories.map(normalizeImportCategory) : []),
    ...templates
      .filter((template) => template.payload.categoryPath.length > 0)
      .map((template) => ({ vendor: template.payload.vendor, path: template.payload.categoryPath }))
  ].filter((category): category is { vendor: string; path: string[] } => category !== null)

  return {
    vendors: Array.from(new Set(vendors)),
    categories,
    templates
  }
}

function getCategoryKey(vendor: string, path: string[]): string {
  return `${vendor}\u0000${path.join('\u0000')}`
}

function indexCategories(categories: TemplateCategory[]): Map<string, TemplateCategory> {
  return new Map(categories.map((category) => [getCategoryKey(category.vendor, category.path), category]))
}

function refreshEditorFontMetrics(
  monaco: typeof import('monaco-editor'),
  editorInstance: editor.IStandaloneCodeEditor
) {
  if (!('fonts' in document)) {
    return
  }

  void document.fonts.ready.then(() => {
    monaco.editor.remeasureFonts()
    editorInstance.layout()
  })
}

function createRange(
  monaco: typeof import('monaco-editor'),
  model: editor.ITextModel,
  range: MonacoRangeShape
): IRange | null {
  if (!isRangeWithinModel(model, range)) {
    return null
  }

  return new monaco.Range(
    range.startLineNumber,
    range.startColumn,
    range.endLineNumber,
    range.endColumn
  )
}

function getVariableTrackingRange(
  monaco: typeof import('monaco-editor'),
  model: editor.ITextModel,
  variable: Variable
): IRange | null {
  return createRange(monaco, model, {
    startLineNumber: variable.startLine,
    startColumn: variable.startColumn,
    endLineNumber: variable.endLine,
    endColumn: variable.endColumn
  })
}

function getVariableVisibleRange(
  monaco: typeof import('monaco-editor'),
  model: editor.ITextModel,
  variable: Variable
): IRange | null {
  const range = getVariableTrackingRange(monaco, model, variable)
  if (!range || isCollapsedRange(range)) {
    return null
  }

  return range
}

function getGroupTrackingRange(
  monaco: typeof import('monaco-editor'),
  model: editor.ITextModel,
  group: { startLine: number; endLine: number }
): IRange | null {
  const lineCount = model.getLineCount()
  if (
    group.startLine < 1 ||
    group.endLine < 1 ||
    group.startLine > group.endLine ||
    group.startLine > lineCount ||
    group.endLine > lineCount
  ) {
    return null
  }

  return new monaco.Range(
    group.startLine,
    1,
    group.endLine,
    model.getLineMaxColumn(group.endLine)
  )
}

function getGeneratedTemplateDecorations(
  monaco: typeof import('monaco-editor'),
  model: editor.ITextModel,
  variables: Variable[]
): editor.IModelDeltaDecoration[] {
  const variableByName = new Map(variables.map((variable) => [variable.name, variable]))
  const decorations: editor.IModelDeltaDecoration[] = []
  const text = model.getValue()

  for (const match of text.matchAll(/<\s*\/?\s*group\b[^>]*>/gi)) {
    const startOffset = match.index ?? 0
    const endOffset = startOffset + match[0].length
    const startPosition = model.getPositionAt(startOffset)
    const endPosition = model.getPositionAt(endOffset)

    decorations.push({
      range: new monaco.Range(startPosition.lineNumber, startPosition.column, endPosition.lineNumber, endPosition.column),
      options: {
        inlineClassName: 'generated-template-group-tag',
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
      }
    })
  }

  for (const match of text.matchAll(/\{\{\s*([\s\S]*?)\s*\}\}/g)) {
    const startOffset = match.index ?? 0
    const endOffset = startOffset + match[0].length
    const startPosition = model.getPositionAt(startOffset)
    const endPosition = model.getPositionAt(endOffset)
    const expression = match[1]?.trim() || ''
    const variableName = expression.split('|')[0]?.trim() || ''
    const variable = variableByName.get(variableName)
    const colorIndex = variable ? getEntityColorIndex(variable.colorIndex, 0) % VARIABLE_COLORS.length : null

    decorations.push({
      range: new monaco.Range(startPosition.lineNumber, startPosition.column, endPosition.lineNumber, endPosition.column),
      options: {
        inlineClassName: colorIndex === null
          ? 'template-parameter-highlight'
          : `template-parameter-highlight template-parameter-color-${colorIndex}`,
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
      }
    })
  }

  return decorations
}

function createGeneratedTemplateVariableId(name: string, index: number) {
  const normalizedName = name.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'variable'
  return `generated-${normalizedName}-${index}`
}

function createGeneratedTemplateGroupId(name: string, index: number) {
  const normalizedName = name.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'group'
  return `generated-group-${normalizedName}-${index}`
}

function getLineColumnFromOffset(text: string, offset: number): { line: number; column: number } {
  const prefix = text.slice(0, offset)
  const lines = prefix.split('\n')
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1
  }
}

function splitTopLevelFilters(expression: string): string[] {
  const filters: string[] = []
  let current = ''
  let quote: string | null = null
  let escaped = false
  let depth = 0

  for (const char of expression) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (char === '\\') {
      current += char
      escaped = true
      continue
    }

    if (quote) {
      current += char
      if (char === quote) {
        quote = null
      }
      continue
    }

    if (char === '"' || char === "'") {
      current += char
      quote = char
      continue
    }

    if (char === '(' || char === '[' || char === '{') {
      current += char
      depth += 1
      continue
    }

    if (char === ')' || char === ']' || char === '}') {
      current += char
      depth = Math.max(0, depth - 1)
      continue
    }

    if (char === '|' && depth === 0) {
      filters.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  filters.push(current.trim())
  return filters.filter(Boolean)
}

function extractTemplateMetadataFromGeneratedTemplate(template: string): { variables: Variable[]; groups: Group[] } {
  const variableMatches = template.matchAll(/\{\{\s*([\s\S]*?)\s*\}\}/g)
  const variables: Variable[] = []
  const groups: Group[] = []
  const groupStack: Array<{ name: string; startLine: number }> = []
  const seenNames = new Set<string>()
  const ignoredNames = new Set(['ignore', '_end_', '_headers_', '_start_', '_line_'])
  const lineCount = template.split('\n').length

  for (const match of template.matchAll(/<group\b[^>]*\bname\s*=\s*["']([^"']+)["'][^>]*>|<\/group>/gi)) {
    const fullMatch = match[0] || ''
    const position = getLineColumnFromOffset(template, match.index || 0)

    if (fullMatch.toLowerCase().startsWith('</group')) {
      const startedGroup = groupStack.pop()
      if (!startedGroup) {
        continue
      }

      const index = groups.length
      groups.push({
        id: createGeneratedTemplateGroupId(startedGroup.name, index),
        name: startedGroup.name,
        startLine: startedGroup.startLine,
        endLine: position.line,
        colorIndex: index % VARIABLE_COLORS.length
      })
      continue
    }

    const groupName = match[1]?.trim()
    if (groupName) {
      groupStack.push({
        name: groupName,
        startLine: position.line
      })
    }
  }

  while (groupStack.length > 0) {
    const startedGroup = groupStack.pop()
    if (!startedGroup) {
      continue
    }

    const index = groups.length
    groups.push({
      id: createGeneratedTemplateGroupId(startedGroup.name, index),
      name: startedGroup.name,
      startLine: startedGroup.startLine,
      endLine: lineCount,
      colorIndex: index % VARIABLE_COLORS.length
    })
  }

  for (const match of variableMatches) {
    const expression = match[1]?.trim()
    if (!expression) {
      continue
    }

    const [nameCandidate, ...filters] = splitTopLevelFilters(expression)
    const name = nameCandidate.trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || ignoredNames.has(name) || seenNames.has(name)) {
      continue
    }

    const index = variables.length
    const startPosition = getLineColumnFromOffset(template, match.index || 0)
    seenNames.add(name)
    variables.push({
      id: createGeneratedTemplateVariableId(name, index),
      name,
      pattern: filters[0] || '',
      indicators: filters.slice(1),
      syntaxMode: 'variable',
      startLine: startPosition.line,
      startColumn: startPosition.column,
      endLine: startPosition.line,
      endColumn: startPosition.column + (match[0]?.length || 0),
      originalText: name,
      colorIndex: index % VARIABLE_COLORS.length
    })
  }

  groups.sort((a, b) => {
    if (a.startLine !== b.startLine) return a.startLine - b.startLine
    return b.endLine - a.endLine
  })

  return { variables, groups }
}

export default function TemplateBuilder() {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)
  const decorationsRef = useRef<string[]>([])
  const variableTrackingDecorationsRef = useRef<Record<string, string>>({})
  const groupTrackingDecorationsRef = useRef<Record<string, string>>({})
  const suppressTrackingSyncRef = useRef(false)
  const contentChangeDisposableRef = useRef<IDisposable | null>(null)
  const modelChangeDisposableRef = useRef<IDisposable | null>(null)
  const generatedEditorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const generatedMonacoRef = useRef<typeof import('monaco-editor') | null>(null)
  const generatedParameterDecorationsRef = useRef<string[]>([])

  const [showModal, setShowModal] = useState(false)
  const [showGroupModal, setShowGroupModal] = useState(false)
  const [currentSelection, setCurrentSelection] = useState<CurrentSelection | null>(null)
  const [editingVariable, setEditingVariable] = useState<Variable | null>(null)
  const [editingGroup, setEditingGroup] = useState<Group | null>(null)
  const [groupSelection, setGroupSelection] = useState<GroupSelection | null>(null)
  const [sampleContextMenu, setSampleContextMenu] = useState<SampleContextMenuState | null>(null)
  const [showTemplateNameModal, setShowTemplateNameModal] = useState(false)
  const [templateNameInput, setTemplateNameInput] = useState('')
  const [templateVendorInput, setTemplateVendorInput] = useState('Unassigned')
  const [templateCategoryInput, setTemplateCategoryInput] = useState('')
  const [isNewVendor, setIsNewVendor] = useState(false)
  const [newVendorInput, setNewVendorInput] = useState('')
  const [isNewCategory, setIsNewCategory] = useState(false)
  const [newCategoryInput, setNewCategoryInput] = useState('')
  const [templateSaveSource, setTemplateSaveSource] = useState<TemplateSaveSource>('sample')
  const [isEditorReady, setIsEditorReady] = useState(false)
  const [isSavingTemplate, setIsSavingTemplate] = useState(false)
  const [isExportingTemplates, setIsExportingTemplates] = useState(false)
  const [isImportingTemplates, setIsImportingTemplates] = useState(false)
  const pendingSyncFrameRef = useRef<number | null>(null)

  const {
    sampleText,
    setSampleText,
    variables,
    groups,
    generatedTemplate,
    addVariable,
    updateVariable,
    removeVariable,
    reorderVariables,
    addGroup,
    removeGroup,
    updateGroup,
    setTemplateName,
    newTemplate,
    patterns,
    savedTemplates,
    saveTemplate,
    loadTemplate,
    deleteTemplate,
    fetchSavedTemplates,
    fetchTemplateDirectories,
    templateName,
    currentTemplateVendor,
    currentTemplateCategoryPath,
    selectedSavedTemplateId,
    isLoadingTemplates,
    isLoadingTemplateDirectories,
    vendors,
    parseCategories,
    theme
  } = useStore()

  const selectedSavedTemplate = savedTemplates.find((savedTemplate) => savedTemplate.id === selectedSavedTemplateId)
  const templateSaveSourceLabel = templateSaveSource === 'sample' ? '样本输入' : '生成模板'

  const rebuildTrackingDecorations = useCallback(() => {
    if (!editorRef.current || !monacoRef.current) {
      return
    }

    const editorInstance = editorRef.current
    const monaco = monacoRef.current
    const model = editorInstance.getModel()
    if (!model) {
      variableTrackingDecorationsRef.current = {}
      groupTrackingDecorationsRef.current = {}
      return
    }

    const state = useStore.getState()
    const nextTrackingDecorations: editor.IModelDeltaDecoration[] = []
    const annotationOrder: Array<{ kind: 'variable' | 'group'; id: string }> = []
    const existingDecorationIds = [
      ...Object.values(variableTrackingDecorationsRef.current),
      ...Object.values(groupTrackingDecorationsRef.current)
    ]

    state.variables.forEach((variable) => {
      const range = getVariableTrackingRange(monaco, model, variable)
      if (!range) {
        return
      }

      nextTrackingDecorations.push({
        range,
        options: {
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
        }
      })
      annotationOrder.push({ kind: 'variable', id: variable.id })
    })

    state.groups.forEach((group) => {
      const range = getGroupTrackingRange(monaco, model, group)
      if (!range) {
        return
      }

      nextTrackingDecorations.push({
        range,
        options: {
          stickiness: monaco.editor.TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges
        }
      })
      annotationOrder.push({ kind: 'group', id: group.id })
    })

    suppressTrackingSyncRef.current = true
    try {
      const nextDecorationIds = editorInstance.deltaDecorations(existingDecorationIds, nextTrackingDecorations)
      const nextVariableTrackingDecorations: Record<string, string> = {}
      const nextGroupTrackingDecorations: Record<string, string> = {}

      annotationOrder.forEach((annotation, index) => {
        const decorationId = nextDecorationIds[index]
        if (!decorationId) {
          return
        }

        if (annotation.kind === 'variable') {
          nextVariableTrackingDecorations[annotation.id] = decorationId
        } else {
          nextGroupTrackingDecorations[annotation.id] = decorationId
        }
      })

      variableTrackingDecorationsRef.current = nextVariableTrackingDecorations
      groupTrackingDecorationsRef.current = nextGroupTrackingDecorations
    } finally {
      suppressTrackingSyncRef.current = false
    }
  }, [])

  const doesTrackingMatchStore = useCallback(() => {
    const editorInstance = editorRef.current
    const model = editorInstance?.getModel()
    const state = useStore.getState()
    const { variables: storeVariables, groups: storeGroups } = state

    if (!editorInstance || !model) {
      return storeVariables.length === 0 && storeGroups.length === 0
    }

    const trackedVariableIds = Object.keys(variableTrackingDecorationsRef.current)
    const trackedGroupIds = Object.keys(groupTrackingDecorationsRef.current)

    if (trackedVariableIds.length !== storeVariables.length || trackedGroupIds.length !== storeGroups.length) {
      return false
    }

    for (const variable of storeVariables) {
      const decorationId = variableTrackingDecorationsRef.current[variable.id]
      if (!decorationId) {
        return false
      }

      const range = model.getDecorationRange(decorationId)
      if (!range) {
        return false
      }

      if (
        range.startLineNumber !== variable.startLine ||
        range.startColumn !== variable.startColumn ||
        range.endLineNumber !== variable.endLine ||
        range.endColumn !== variable.endColumn
      ) {
        return false
      }
    }

    for (const group of storeGroups) {
      const decorationId = groupTrackingDecorationsRef.current[group.id]
      if (!decorationId) {
        return false
      }

      const range = model.getDecorationRange(decorationId)
      if (!range) {
        return false
      }

      if (
        range.startLineNumber !== group.startLine ||
        range.startColumn !== 1 ||
        range.endLineNumber !== group.endLine
      ) {
        return false
      }
    }

    return true
  }, [])

  const syncTrackedRangesToStore = useCallback(() => {
    const editorInstance = editorRef.current
    const model = editorInstance?.getModel()
    if (!editorInstance || !model) {
      return
    }

    const state = useStore.getState()
    const variableUpdates = state.variables.flatMap((variable) => {
      const decorationId = variableTrackingDecorationsRef.current[variable.id]
      if (!decorationId) {
        return []
      }

      const range = model.getDecorationRange(decorationId)
      if (!range) {
        return []
      }

      const originalText = model.getValueInRange(range)
      const positionChanged = (
        variable.startLine !== range.startLineNumber ||
        variable.startColumn !== range.startColumn ||
        variable.endLine !== range.endLineNumber ||
        variable.endColumn !== range.endColumn
      )

      if (!positionChanged && variable.originalText === originalText) {
        return []
      }

      return [{
        id: variable.id,
        startLine: range.startLineNumber,
        startColumn: range.startColumn,
        endLine: range.endLineNumber,
        endColumn: range.endColumn,
        originalText
      }]
    })

    const groupUpdates = state.groups.flatMap((group) => {
      const decorationId = groupTrackingDecorationsRef.current[group.id]
      if (!decorationId) {
        return []
      }

      const range = model.getDecorationRange(decorationId)
      if (!range) {
        return []
      }

      if (group.startLine === range.startLineNumber && group.endLine === range.endLineNumber) {
        return []
      }

      return [{
        id: group.id,
        startLine: range.startLineNumber,
        endLine: range.endLineNumber
      }]
    })

    if (variableUpdates.length > 0) {
      state.syncVariableRanges(variableUpdates)
    }

    if (groupUpdates.length > 0) {
      state.syncGroupRanges(groupUpdates)
    }
  }, [])

  const scheduleTrackedRangeSync = useCallback(() => {
    if (pendingSyncFrameRef.current !== null) {
      return
    }

    pendingSyncFrameRef.current = window.requestAnimationFrame(() => {
      pendingSyncFrameRef.current = null

      if (suppressTrackingSyncRef.current) {
        return
      }

      syncTrackedRangesToStore()
    })
  }, [syncTrackedRangesToStore])

  const flushTrackedRangeSync = useCallback(() => {
    if (pendingSyncFrameRef.current !== null) {
      window.cancelAnimationFrame(pendingSyncFrameRef.current)
      pendingSyncFrameRef.current = null
    }

    if (!suppressTrackingSyncRef.current) {
      syncTrackedRangesToStore()
    }
  }, [syncTrackedRangesToStore])

  const syncGeneratedTemplateVariables = useCallback(() => {
    const metadata = extractTemplateMetadataFromGeneratedTemplate(useStore.getState().generatedTemplate)
    useStore.setState({
      variables: metadata.variables,
      groups: metadata.groups
    })
    return metadata
  }, [])

  const prepareTemplateForSave = useCallback((source: TemplateSaveSource): TemplateSaveSource => {
    if (source === 'sample') {
      flushTrackedRangeSync()
      useStore.getState().generateTemplate()
      return 'generated'
    }

    syncGeneratedTemplateVariables()
    return 'generated'
  }, [flushTrackedRangeSync, syncGeneratedTemplateVariables])

  // Function to apply decorations
  const applyDecorations = useCallback(() => {
    if (!editorRef.current || !monacoRef.current) return

    const monaco = monacoRef.current
    const editorInstance = editorRef.current
    const model = editorInstance.getModel()
    if (!model) return

    if (variables.length === 0 && groups.length === 0) {
      decorationsRef.current = editorInstance.deltaDecorations(decorationsRef.current, [])
      return
    }

    const newDecorations: editor.IModelDeltaDecoration[] = []

    // Add variable decorations
    variables.forEach((v, index) => {
      const range = getVariableVisibleRange(monaco, model, v)
      if (!range) {
        return
      }

      const colorIndex = getEntityColorIndex(v.colorIndex, index) % VARIABLE_COLORS.length

      newDecorations.push({
        range,
        options: {
          className: `variable-highlight-${colorIndex}`,
          inlineClassName: 'inline-variable-highlight',
          inlineClassNameAffectsLetterSpacing: true,
          before: {
            content: v.name,
            inlineClassName: `variable-label variable-label-${colorIndex}`,
            cursorStops: monaco.editor.InjectedTextCursorStops.Left
          },
          overviewRuler: {
            color: getVariableColor(colorIndex),
            position: monaco.editor.OverviewRulerLane.Center
          }
        }
      })
    })

    // Add group decorations - highlight current start and end lines
    groups.forEach((g, index) => {
      const lineCount = model.getLineCount()
      if (g.startLine < 1 || g.endLine < 1 || g.startLine > g.endLine || g.startLine > lineCount || g.endLine > lineCount) {
        return
      }

      const colorIndex = getEntityColorIndex(g.colorIndex, index) % VARIABLE_COLORS.length
      const groupLineClassName = `group-line-highlight group-line-highlight-${colorIndex}`
      const groupMarkerClassName = `group-marker group-marker-${colorIndex}`

      // Add decoration for the start line (show group start marker)
      newDecorations.push({
        range: new monaco.Range(g.startLine, 1, g.startLine, 1),
        options: {
          isWholeLine: true,
          className: groupLineClassName,
          before: {
            content: `<group name="${g.name}">`,
            inlineClassName: `${groupMarkerClassName} group-marker-start`,
            cursorStops: monaco.editor.InjectedTextCursorStops.Left
          },
          overviewRuler: {
            color: getVariableColor(colorIndex),
            position: monaco.editor.OverviewRulerLane.Left
          }
        }
      })

      // Add decoration for the end line (show group end marker)
      if (g.endLine !== g.startLine) {
        newDecorations.push({
          range: new monaco.Range(g.endLine, 1, g.endLine, 1),
          options: {
            isWholeLine: true,
            className: groupLineClassName,
            after: {
              content: '</group>',
              inlineClassName: `${groupMarkerClassName} group-marker-end`,
              cursorStops: monaco.editor.InjectedTextCursorStops.Right
            }
          }
        })
      } else {
        // Single line group - show both markers on same line
        newDecorations.push({
          range: new monaco.Range(g.startLine, 1, g.startLine, 1),
          options: {
            isWholeLine: true,
            className: groupLineClassName,
            after: {
              content: '</group>',
              inlineClassName: `${groupMarkerClassName} group-marker-end`,
              cursorStops: monaco.editor.InjectedTextCursorStops.Right
            }
          }
        })
      }
    })

    decorationsRef.current = editorInstance.deltaDecorations(
      decorationsRef.current,
      newDecorations
    )
  }, [variables, groups])

  useEffect(() => {
    if (!isEditorReady) {
      return
    }

    if (!doesTrackingMatchStore()) {
      rebuildTrackingDecorations()
      return
    }

    if (suppressTrackingSyncRef.current) {
      suppressTrackingSyncRef.current = false
    }
  }, [isEditorReady, variables, groups, doesTrackingMatchStore, rebuildTrackingDecorations])

  useEffect(() => {
    if (!isEditorReady || !editorRef.current) {
      return
    }

    contentChangeDisposableRef.current?.dispose()
    contentChangeDisposableRef.current = editorRef.current.onDidChangeModelContent(() => {
      if (suppressTrackingSyncRef.current) {
        return
      }

      scheduleTrackedRangeSync()
    })

    return () => {
      contentChangeDisposableRef.current?.dispose()
      contentChangeDisposableRef.current = null
    }
  }, [isEditorReady, scheduleTrackedRangeSync])

  useEffect(() => {
    if (!isEditorReady || !editorRef.current) {
      return
    }

    modelChangeDisposableRef.current?.dispose()
    modelChangeDisposableRef.current = editorRef.current.onDidChangeModel(() => {
      rebuildTrackingDecorations()
      applyDecorations()
    })

    return () => {
      modelChangeDisposableRef.current?.dispose()
      modelChangeDisposableRef.current = null
    }
  }, [isEditorReady, rebuildTrackingDecorations, applyDecorations])

  useEffect(() => {
    return () => {
      if (pendingSyncFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingSyncFrameRef.current)
        pendingSyncFrameRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!isEditorReady) return

    const styleId = 'ttp-variable-styles'
    let styleEl = document.getElementById(styleId)
    if (!styleEl) {
      styleEl = document.createElement('style')
      styleEl.id = styleId
      document.head.appendChild(styleEl)
    }

    const isDark = theme === 'dark'
    const bgOpacity = isDark ? '40' : '30'
    const groupBgOpacity = isDark ? '20' : '15'

    const cssRules = VARIABLE_COLORS.map((color, i) => `
      .variable-highlight-${i} {
        background-color: ${color}${bgOpacity} !important;
        border-radius: 3px;
        padding: 1px 0 !important;
        box-decoration-break: clone;
        -webkit-box-decoration-break: clone;
      }
      .variable-label-${i} {
        background-color: ${color} !important;
        color: white !important;
      }
      .group-line-highlight-${i} {
        background-color: ${color}${groupBgOpacity} !important;
        border-left: 3px solid ${color} !important;
      }
      .group-marker-${i}.group-marker-start {
        background-color: ${color} !important;
        color: white !important;
      }
      .group-marker-${i}.group-marker-end {
        background-color: ${color}${isDark ? '33' : '22'} !important;
        color: ${color} !important;
        border: 1px solid ${color}${isDark ? '88' : '66'} !important;
      }
    `).join('\n')

    styleEl.textContent = cssRules + `
      .variable-label {
        font-size: 12px;
        padding: 0 4px;
        margin-right: 4px;
        border-radius: 3px;
        font-weight: bold;
      }
      .group-line-highlight {
        border-left-width: 3px !important;
        border-left-style: solid !important;
      }
      .group-marker {
        font-family: var(--font-mono);
        font-size: 12px;
        padding: 0 6px;
        border-radius: 3px;
        font-weight: bold;
      }
      .group-marker-start {
        margin-right: 8px;
      }
      .group-marker-end {
        margin-left: 8px;
      }
    `
  }, [isEditorReady, theme])

  // Update decorations when variables, groups, or editor becomes ready
  useEffect(() => {
    if (!isEditorReady) {
      return
    }

    const timer = setTimeout(() => {
      applyDecorations()
    }, 100)

    return () => clearTimeout(timer)
  }, [isEditorReady, variables, groups, applyDecorations])

  useEffect(() => {
    if (!generatedEditorRef.current || !generatedMonacoRef.current) {
      return
    }

    const model = generatedEditorRef.current.getModel()
    if (!model) {
      return
    }

    generatedParameterDecorationsRef.current = generatedEditorRef.current.deltaDecorations(
      generatedParameterDecorationsRef.current,
      getGeneratedTemplateDecorations(generatedMonacoRef.current, model, variables)
    )
  }, [generatedTemplate, variables])

  // Update editor theme when app theme changes
  useEffect(() => {
    if (monacoRef.current && editorRef.current) {
      monacoRef.current.editor.setTheme(theme === 'dark' ? 'ttp-dark' : 'ttp-light')
    }
    if (generatedMonacoRef.current && generatedEditorRef.current) {
      generatedMonacoRef.current.editor.setTheme(theme === 'dark' ? 'ttp-dark' : 'ttp-light')
    }
  }, [theme])

  useEffect(() => {
    if (!sampleContextMenu) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSampleContextMenu(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [sampleContextMenu])

  const openVariableModalFromSelection = useCallback((selection: CurrentSelection) => {
    setEditingVariable(null)
    setCurrentSelection(selection)
    setShowModal(true)
  }, [])

  const openGroupModalFromSelection = useCallback((selection: GroupSelection) => {
    setEditingGroup(null)
    setGroupSelection(selection)
    setShowGroupModal(true)
  }, [])

  const handleSampleContextAddVariable = useCallback(() => {
    if (!sampleContextMenu) {
      return
    }

    openVariableModalFromSelection(sampleContextMenu)
    setSampleContextMenu(null)
  }, [sampleContextMenu, openVariableModalFromSelection])

  const handleSampleContextAddGroup = useCallback(() => {
    if (!sampleContextMenu) {
      return
    }

    openGroupModalFromSelection({
      text: sampleContextMenu.text,
      startLine: sampleContextMenu.startLine,
      endLine: sampleContextMenu.endLine
    })
    setSampleContextMenu(null)
  }, [sampleContextMenu, openGroupModalFromSelection])

  // Handle sample editor mount
  const handleEditorMount: OnMount = (editorInstance, monaco) => {
    editorRef.current = editorInstance
    monacoRef.current = monaco
    refreshEditorFontMetrics(monaco, editorInstance)

    // Define dark theme
    monaco.editor.defineTheme('ttp-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#1e1e2e'
      }
    })

    // Define light theme
    monaco.editor.defineTheme('ttp-light', {
      base: 'vs',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#ffffff'
      }
    })

    monaco.editor.setTheme(theme === 'dark' ? 'ttp-dark' : 'ttp-light')

    // Add variable action (single line selection)
    editorInstance.addAction({
      id: 'ttp-add-variable',
      label: 'Add as TTP Variable',
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1,
      run: (ed) => {
        const selection = ed.getSelection()
        if (!selection || selection.isEmpty()) return

        const model = ed.getModel()
        if (!model) return

        const selectedText = model.getValueInRange(selection)

        openVariableModalFromSelection({
          text: selectedText,
          startLine: selection.startLineNumber,
          startColumn: selection.startColumn,
          endLine: selection.endLineNumber,
          endColumn: selection.endColumn
        })
      }
    })

    // Add group action (multi-line selection)
    editorInstance.addAction({
      id: 'ttp-add-group',
      label: 'Add as TTP Group',
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 2,
      run: (ed) => {
        const selection = ed.getSelection()
        if (!selection || selection.isEmpty()) return

        const model = ed.getModel()
        if (!model) return

        const selectedText = model.getValueInRange(selection)

        openGroupModalFromSelection({
          text: selectedText,
          startLine: selection.startLineNumber,
          endLine: selection.endLineNumber
        })
      }
    })

    const editorDomNode = editorInstance.getDomNode()
    const handleSampleContextMenu = (event: MouseEvent) => {
      const selection = editorInstance.getSelection()
      const model = editorInstance.getModel()

      if (!selection || selection.isEmpty() || !model) {
        setSampleContextMenu(null)
        return
      }

      const selectedText = model.getValueInRange(selection)
      if (!selectedText.trim()) {
        setSampleContextMenu(null)
        return
      }

      event.preventDefault()
      event.stopPropagation()
      setSampleContextMenu({
        x: event.clientX,
        y: event.clientY,
        text: selectedText,
        startLine: selection.startLineNumber,
        startColumn: selection.startColumn,
        endLine: selection.endLineNumber,
        endColumn: selection.endColumn
      })
    }

    editorDomNode?.addEventListener('contextmenu', handleSampleContextMenu)
    editorInstance.onDidDispose(() => {
      editorDomNode?.removeEventListener('contextmenu', handleSampleContextMenu)
    })

    rebuildTrackingDecorations()
    setIsEditorReady(true)
  }

  // Handle generated template editor mount
  const handleGeneratedEditorMount: OnMount = (editorInstance, monaco) => {
    generatedEditorRef.current = editorInstance
    generatedMonacoRef.current = monaco
    refreshEditorFontMetrics(monaco, editorInstance)

    // Use same themes
    monaco.editor.defineTheme('ttp-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#1e1e2e'
      }
    })

    monaco.editor.defineTheme('ttp-light', {
      base: 'vs',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#ffffff'
      }
    })

    monaco.editor.setTheme(theme === 'dark' ? 'ttp-dark' : 'ttp-light')

    const model = editorInstance.getModel()
    if (model) {
      generatedParameterDecorationsRef.current = editorInstance.deltaDecorations(
        generatedParameterDecorationsRef.current,
        getGeneratedTemplateDecorations(monaco, model, variables)
      )
    }
  }

  const handleVariableModalClose = useCallback(() => {
    setShowModal(false)
    setCurrentSelection(null)
    setEditingVariable(null)
  }, [])

  const handleVariableCreated = useCallback((
    name: string,
    pattern: string,
    indicators: string[],
    syntaxMode: VariableSyntaxMode,
    options?: { ignoreValue?: string; headersColumns?: number | null }
  ) => {
    if (!currentSelection) return

    addVariable({
      name,
      pattern,
      indicators,
      syntaxMode,
      ignoreValue: options?.ignoreValue,
      headersColumns: options?.headersColumns ?? null,
      startLine: currentSelection.startLine,
      startColumn: currentSelection.startColumn,
      endLine: currentSelection.endLine,
      endColumn: currentSelection.endColumn,
      originalText: currentSelection.text
    })

    handleVariableModalClose()
  }, [currentSelection, addVariable, handleVariableModalClose])

  const handleVariableEdited = useCallback((
    name: string,
    pattern: string,
    indicators: string[],
    syntaxMode: VariableSyntaxMode,
    options?: { ignoreValue?: string; headersColumns?: number | null }
  ) => {
    if (!editingVariable) return

    updateVariable(editingVariable.id, {
      name,
      pattern,
      indicators,
      syntaxMode,
      ignoreValue: options?.ignoreValue,
      headersColumns: options?.headersColumns ?? null
    })

    handleVariableModalClose()
  }, [editingVariable, updateVariable, handleVariableModalClose])

  const handleEditVariable = useCallback((variable: Variable) => {
    setCurrentSelection(null)
    setEditingVariable(variable)
    setShowModal(true)
  }, [])

  const handleEditGroup = useCallback((group: Group) => {
    const lines = sampleText.split('\n')
    setEditingGroup(group)
    setGroupSelection({
      text: lines.slice(group.startLine - 1, group.endLine).join('\n'),
      startLine: group.startLine,
      endLine: group.endLine
    })
    setShowGroupModal(true)
  }, [sampleText])

  const handleGroupModalClose = useCallback(() => {
    setShowGroupModal(false)
    setGroupSelection(null)
    setEditingGroup(null)
  }, [])

  const handleGroupCreated = useCallback((name: string) => {
    if (!groupSelection) return

    if (editingGroup) {
      updateGroup(editingGroup.id, { name })
      handleGroupModalClose()
      return
    }

    addGroup({
      name,
      startLine: groupSelection.startLine,
      endLine: groupSelection.endLine
    })

    handleGroupModalClose()
  }, [groupSelection, editingGroup, updateGroup, addGroup, handleGroupModalClose])

  const handleSaveTemplate = useCallback(async (source: TemplateSaveSource) => {
    const hasSampleInput = sampleText.trim().length > 0
    const hasGeneratedTemplate = generatedTemplate.trim().length > 0

    if (source === 'sample' && !hasSampleInput) {
      alert('Please enter Sample Input before saving')
      return
    }

    if (source === 'generated' && !hasGeneratedTemplate) {
      alert('Please enter Generated Template before saving')
      return
    }

    const persistenceSource = prepareTemplateForSave(source)
    setTemplateSaveSource(source)

    if (selectedSavedTemplateId && selectedSavedTemplate) {
      setIsSavingTemplate(true)
      try {
        await saveTemplate(
          selectedSavedTemplate.name,
          selectedSavedTemplate.description || '',
          selectedSavedTemplate.vendor || currentTemplateVendor || 'Unassigned',
          selectedSavedTemplate.categoryPath || currentTemplateCategoryPath || [],
          persistenceSource
        )
      } finally {
        setIsSavingTemplate(false)
      }
      return
    }

    setTemplateNameInput(templateName || '')
    setTemplateVendorInput(currentTemplateVendor || 'Unassigned')
    setTemplateCategoryInput((currentTemplateCategoryPath || []).join('/'))
    setIsNewVendor(false)
    setNewVendorInput('')
    setIsNewCategory(false)
    setNewCategoryInput('')
    setShowTemplateNameModal(true)
  }, [sampleText, generatedTemplate, templateName, selectedSavedTemplateId, selectedSavedTemplate, currentTemplateVendor, currentTemplateCategoryPath, saveTemplate, prepareTemplateForSave])

  const handleTemplateNameSubmit = useCallback(async () => {
    const name = templateNameInput || 'data'
    const finalVendor = isNewVendor ? (newVendorInput.trim() || 'Unassigned') : templateVendorInput
    const rawCategory = isNewCategory ? newCategoryInput : templateCategoryInput
    const categoryPath = rawCategory.split('/').map((segment) => segment.trim()).filter(Boolean)
    setTemplateName(name)
    const persistenceSource = prepareTemplateForSave(templateSaveSource)
    setIsSavingTemplate(true)
    try {
      await saveTemplate(name, '', finalVendor, categoryPath, persistenceSource)
      setShowTemplateNameModal(false)
      setTemplateNameInput('')
      setTemplateVendorInput('Unassigned')
      setTemplateCategoryInput('')
      setIsNewVendor(false)
      setNewVendorInput('')
      setIsNewCategory(false)
      setNewCategoryInput('')
    } finally {
      setIsSavingTemplate(false)
    }
  }, [templateNameInput, templateVendorInput, templateCategoryInput, isNewVendor, newVendorInput, isNewCategory, newCategoryInput, templateSaveSource, setTemplateName, saveTemplate, prepareTemplateForSave])

  const handleLoadTemplate = useCallback(async (id: string) => {
    suppressTrackingSyncRef.current = true
    await loadTemplate(id)
  }, [loadTemplate])

  const handleDeleteTemplate = useCallback(async (id: string) => {
    if (confirm('Delete this template?')) {
      await deleteTemplate(id)
    }
  }, [deleteTemplate])

  const importTemplateLibrary = useCallback(async (libraryImport: TemplateLibraryImport) => {
    setIsImportingTemplates(true)

    try {
      await Promise.all([
        fetchSavedTemplates(),
        fetchTemplateDirectories()
      ])

      const initialState = useStore.getState()
      const existingVendors = new Set(initialState.vendors.map((vendor) => vendor.name))

      for (const vendor of libraryImport.vendors) {
        if (!existingVendors.has(vendor)) {
          try {
            await createVendorRequest(vendor)
            existingVendors.add(vendor)
          } catch {
            existingVendors.add(vendor)
          }
        }
      }

      await fetchTemplateDirectories()

      const categoryByKey = indexCategories(useStore.getState().parseCategories)
      const categoriesToEnsure = Array.from(
        new Map(
          libraryImport.categories
            .flatMap((category) => category.path.map((_, index) => ({
              vendor: category.vendor,
              path: category.path.slice(0, index + 1)
            })))
            .map((category) => [getCategoryKey(category.vendor, category.path), category])
        ).values()
      ).sort((a, b) => a.path.length - b.path.length)

      for (const category of categoriesToEnsure) {
        let parentId: string | null = null

        for (let index = 0; index < category.path.length; index += 1) {
          const currentPath = category.path.slice(0, index + 1)
          const key = getCategoryKey(category.vendor, currentPath)
          const existing = categoryByKey.get(key)

          if (existing) {
            parentId = existing.id
            continue
          }

          try {
            const created = await createCategoryRequest('parse', {
              vendor: category.vendor,
              name: currentPath[currentPath.length - 1],
              parentId
            })
            categoryByKey.set(key, created)
            parentId = created.id
          } catch {
            await fetchTemplateDirectories()
            const refreshedCategories = indexCategories(useStore.getState().parseCategories)
            categoryByKey.clear()
            refreshedCategories.forEach((value, refreshedKey) => categoryByKey.set(refreshedKey, value))
            parentId = categoryByKey.get(key)?.id ?? parentId
          }
        }
      }

      await fetchSavedTemplates()

      const existingTemplatesById = new Map(useStore.getState().savedTemplates.map((template) => [template.id, template]))
      let createdCount = 0
      let updatedCount = 0

      for (const template of libraryImport.templates) {
        if (template.id && existingTemplatesById.has(template.id)) {
          await updateTemplateRequest(template.id, template.payload)
          updatedCount += 1
          continue
        }

        await createTemplateRequest(template.payload)
        createdCount += 1
      }

      await Promise.all([
        fetchSavedTemplates(),
        fetchTemplateDirectories()
      ])

      alert(`导入完成：新增 ${createdCount} 个，更新 ${updatedCount} 个。`)
    } finally {
      setIsImportingTemplates(false)
    }
  }, [fetchSavedTemplates, fetchTemplateDirectories])

  const handleTemplateUpload = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    const content = await file.text()
    const uploadedTemplateName = file.name.replace(/\.[^/.]+$/, '').trim()
    const libraryImport = parseTemplateLibraryImport(content)

    if (libraryImport) {
      try {
        await importTemplateLibrary(libraryImport)
      } catch (error) {
        alert(error instanceof Error ? error.message : '导入模板库失败')
      }
      return
    }

    useStore.setState({
      sampleText: '',
      variables: [],
      groups: [],
      generatedTemplate: content,
      templateName: uploadedTemplateName || 'Imported Template',
      selectedSavedTemplateId: null
    })
  }, [importTemplateLibrary])

  const handleDownloadTemplate = useCallback(async () => {
    setIsExportingTemplates(true)

    try {
      await Promise.all([
        fetchSavedTemplates(),
        fetchTemplateDirectories()
      ])

      const {
        savedTemplates: latestTemplates,
        vendors: latestVendors,
        parseCategories: latestCategories
      } = useStore.getState()

      if (latestTemplates.length === 0) {
        alert('暂无可导出的模板')
        return
      }

      const payload = {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        templateCount: latestTemplates.length,
        vendorCount: latestVendors.length,
        categoryCount: latestCategories.length,
        vendors: latestVendors,
        categories: latestCategories,
        templates: latestTemplates.map((template) => ({
          id: template.id,
          name: template.name,
          description: template.description,
          vendor: template.vendor || 'Unassigned',
          categoryPath: template.categoryPath || [],
          sampleText: template.sampleText,
          variables: template.variables,
          groups: template.groups || [],
          generatedTemplate: template.generatedTemplate,
          createdAt: template.createdAt,
          updatedAt: template.updatedAt
        }))
      }
      const exportedDate = new Date().toISOString().slice(0, 10)
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })

      saveAs(blob, `ip-ttp-templates-${exportedDate}.json`)
    } catch (error) {
      alert(error instanceof Error ? error.message : '导出模板失败')
    } finally {
      setIsExportingTemplates(false)
    }
  }, [fetchSavedTemplates, fetchTemplateDirectories])

  return (
    <div className="template-builder-page flex flex-col h-full" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Header */}
      <div className="page-header">
        <h2>模板构建</h2>
        <div className="flex gap-2">
          <label
            className="btn cursor-pointer"
            title="上传模板库 JSON，或上传单个 .ttp/.txt/.xml 模板"
            style={isImportingTemplates ? { pointerEvents: 'none', opacity: 0.65 } : undefined}
          >
            {isImportingTemplates ? '导入中...' : '上传模板'}
            <input
              type="file"
              accept=".json,.txt,.ttp,.xml,application/json,text/plain"
              className="hidden"
              onChange={handleTemplateUpload}
              disabled={isImportingTemplates}
            />
          </label>
          <button
            onClick={newTemplate}
            className="btn"
            disabled={!sampleText && !generatedTemplate && variables.length === 0 && groups.length === 0 && !templateName && !selectedSavedTemplateId}
          >
            新建
          </button>
          <button
            onClick={() => { void handleDownloadTemplate() }}
            className="btn"
            disabled={isExportingTemplates || isLoadingTemplates}
            title="导出全部模板，并保留厂商和文件夹信息"
          >
            {isExportingTemplates ? '导出中...' : '下载模板'}
          </button>
        </div>
      </div>

      {/* Main content area - 4 panels */}
      <div className="flex-1 flex min-h-0">
        {/* Left: Saved Templates Sidebar */}
        <div className="template-library-sidebar border-r flex-shrink-0" style={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
          <TemplateDirectoryTree
            title="模板库"
            vendors={vendors}
            categories={parseCategories}
            templates={savedTemplates}
            loading={isLoadingTemplates || isLoadingTemplateDirectories}
            emptyText="暂无保存模板"
            activeTemplateId={selectedSavedTemplateId}
            manageDirectories
            onTemplateClick={(templateId) => { void handleLoadTemplate(templateId) }}
            onMoveTemplate={(templateId, vendor, categoryPath) => useStore.getState().moveTemplate(templateId, vendor, categoryPath)}
            onDeleteTemplate={(templateId) => { void handleDeleteTemplate(templateId) }}
            onCreateVendor={(name) => useStore.getState().createVendor(name)}
            onRenameVendor={(currentName, nextName) => useStore.getState().renameVendor(currentName, nextName)}
            onDeleteVendor={(name) => useStore.getState().deleteVendor(name)}
            onCreateCategory={(vendor, name, parentId) => useStore.getState().createCategory('parse', vendor, name, parentId)}
            onRenameCategory={(categoryId, vendor, name, parentId) => useStore.getState().updateCategory('parse', categoryId, vendor, name, parentId)}
            onDeleteCategory={(categoryId) => useStore.getState().deleteCategory('parse', categoryId)}
          />
        </div>

        {/* Center: Sample Input + Generated Template (side by side) */}
        <div className="flex-1 flex min-w-0">
          {/* Sample Input Editor (Left) */}
          <div className="template-editor-panel border-r" style={{ borderColor: 'var(--border-color)' }}>
            <div className="template-editor-header gap-3" style={{ backgroundColor: 'var(--bg-header)', borderColor: 'var(--border-color)' }}>
              <div className="sample-editor-title-row">
                <span className="sample-editor-title-main">样本输入</span>
                <span className="sample-editor-title-hint">右键选择文本 → 添加变量 / 组</span>
              </div>
              <button
                type="button"
                onClick={() => { void handleSaveTemplate('sample') }}
                disabled={isSavingTemplate || !sampleText.trim()}
                className="btn px-2 py-1 text-xs"
                style={{ fontSize: '12px', padding: '2px 8px' }}
                title="保存样本输入并重新生成模板"
              >
                保存样本
              </button>
            </div>
            <div className="template-editor-body">
              <Editor
                height="100%"
                defaultLanguage="plaintext"
                value={sampleText}
                onChange={(value) => setSampleText(value || '')}
                onMount={handleEditorMount}
                options={{
                  minimap: { enabled: false },
                  lineNumbers: 'on',
                  wordWrap: 'on',
                  fontSize: 13,
                  lineHeight: 20,
                  fontFamily: EDITOR_FONT_FAMILY,
                  padding: { top: 8 },
                  scrollBeyondLastLine: false,
                  contextmenu: false,
                  automaticLayout: true
                }}
              />
            </div>
            {/* Instructions overlay */}
            {sampleText === '' && (
              <div className="template-editor-empty-overlay">
                <div className="text-center p-8" style={{ color: 'var(--text-muted)' }}>
                  <p className="template-builder-empty-title">输入样本内容或加载文件</p>
                  <p className="template-builder-empty-text">选择文本后右键添加变量或组</p>
                </div>
              </div>
            )}
          </div>

          {/* Generated Template Editor (Right) */}
          <div className="template-editor-panel" style={{ minWidth: '200px' }}>
            <div className="template-editor-header gap-3" style={{ backgroundColor: 'var(--bg-header)', borderColor: 'var(--border-color)' }}>
              <div className="sample-editor-title-row">
                <span className="sample-editor-title-main">生成的模板</span>
                {templateName && <span className="sample-editor-title-hint">{templateName}</span>}
              </div>
              <button
                type="button"
                onClick={() => { void handleSaveTemplate('generated') }}
                disabled={isSavingTemplate || !generatedTemplate.trim()}
                className="btn px-2 py-1 text-xs"
                style={{ fontSize: '12px', padding: '2px 8px' }}
                title="按当前内容保存生成模板"
              >
                保存模板
              </button>
            </div>
            <div className="template-editor-body">
              <Editor
                height="100%"
                defaultLanguage="xml"
                value={generatedTemplate}
                onMount={handleGeneratedEditorMount}
                onChange={(value) => useStore.setState({ generatedTemplate: value ?? '' })}
                options={{
                  minimap: { enabled: false },
                  lineNumbers: 'on',
                  wordWrap: 'on',
                  fontSize: 13,
                  lineHeight: 20,
                  fontFamily: EDITOR_FONT_FAMILY,
                  padding: { top: 8 },
                  scrollBeyondLastLine: false,
                  automaticLayout: true
                }}
              />
            </div>
          </div>
        </div>

        {/* Right: Variable list sidebar */}
        <div className="template-builder-entity-sidebar">
          <VariableList
            variables={variables}
            groups={groups}
            onEditVariable={handleEditVariable}
            onEditGroup={handleEditGroup}
            onRemoveVariable={removeVariable}
            onRemoveGroup={removeGroup}
            onReorderVariable={reorderVariables}
          />
        </div>
      </div>

      {sampleContextMenu && (
        <ContextMenu
          x={sampleContextMenu.x}
          y={sampleContextMenu.y}
          selectedText={sampleContextMenu.text}
          onAddVariable={handleSampleContextAddVariable}
          onAddGroup={handleSampleContextAddGroup}
          onClose={() => setSampleContextMenu(null)}
        />
      )}

      {/* Variable Modal */}
      {showModal && (currentSelection || editingVariable) && (
        <VariableModal
          mode={editingVariable ? 'edit' : 'create'}
          selectedText={editingVariable?.originalText || currentSelection?.text || ''}
          patterns={patterns}
          initialVariable={editingVariable}
          onConfirm={editingVariable ? handleVariableEdited : handleVariableCreated}
          onCancel={handleVariableModalClose}
        />
      )}

      {/* Group Modal */}
      {showGroupModal && groupSelection && (
        <GroupModal
          selectedText={groupSelection.text}
          startLine={groupSelection.startLine}
          endLine={groupSelection.endLine}
          mode={editingGroup ? 'edit' : 'create'}
          initialName={editingGroup?.name}
          onConfirm={handleGroupCreated}
          onCancel={handleGroupModalClose}
        />
      )}

      {/* Template Name Modal */}
      {showTemplateNameModal && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'var(--overlay-backdrop)' }} onClick={(e) => { if (e.target === e.currentTarget) setShowTemplateNameModal(false) }}>
          <div className="template-save-modal" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <h3 style={{ color: 'var(--text-primary)' }}>保存{templateSaveSourceLabel}</h3>
            <p className="template-save-modal-subtitle" style={{ color: 'var(--text-muted)' }}>
              {templateSaveSource === 'sample'
                ? '样本输入优先，将重新生成并存储模板。'
                : '生成模板将按当前内容原样存储。'}
            </p>
            <div className="mb-3">
              <div className="template-save-modal-label" style={{ color: 'var(--text-muted)' }}>模板名称</div>
              <input
                type="text"
                value={templateNameInput}
                onChange={(e) => setTemplateNameInput(e.target.value)}
                placeholder="例如 interfaces"
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2"
                style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                autoFocus
              />
            </div>
            {/* Vendor selector */}
            <div className="mb-3">
              <div className="template-save-modal-label" style={{ color: 'var(--text-muted)' }}>厂商</div>
              {!isNewVendor ? (
                <select
                  value={templateVendorInput}
                  onChange={(e) => {
                    if (e.target.value === '__new__') {
                      setIsNewVendor(true)
                      setNewVendorInput('')
                      setTemplateCategoryInput('')
                      setIsNewCategory(false)
                      setNewCategoryInput('')
                    } else {
                      setTemplateVendorInput(e.target.value)
                      setTemplateCategoryInput('')
                      setIsNewCategory(false)
                      setNewCategoryInput('')
                    }
                  }}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2"
                  style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                >
                  <option value="Unassigned">未分类厂商</option>
                  {vendors.map((vendor) => (
                    <option key={vendor.name} value={vendor.name}>{vendor.name}</option>
                  ))}
                  <option value="__new__">+ 新建厂商...</option>
                </select>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newVendorInput}
                    onChange={(e) => setNewVendorInput(e.target.value)}
                    placeholder="新厂商名称"
                    className="flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2"
                    style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                    autoFocus
                  />
                  <button
                    onClick={() => { setIsNewVendor(false); setTemplateVendorInput(templateVendorInput) }}
                    className="btn"
                    type="button"
                  >取消</button>
                </div>
              )}
            </div>
            {/* Folder path selector */}
            <div className="mb-4">
              <div className="template-save-modal-label" style={{ color: 'var(--text-muted)' }}>分类路径</div>
              {(() => {
                const activeVendor = isNewVendor ? newVendorInput.trim() : templateVendorInput
                const vendorCategories = parseCategories.filter((cat) => cat.vendor === activeVendor)
                return !isNewCategory ? (
                  <select
                    value={templateCategoryInput}
                    onChange={(e) => {
                      if (e.target.value === '__new__') {
                        setIsNewCategory(true)
                        setNewCategoryInput('')
                      } else {
                        setTemplateCategoryInput(e.target.value)
                      }
                    }}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2"
                    style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                  >
                    <option value="">无分类（顶层）</option>
                    {vendorCategories.map((cat) => (
                      <option key={cat.id} value={cat.path.join('/')}>{cat.path.join('/')}</option>
                    ))}
                    <option value="__new__">+ 新建分类路径...</option>
                  </select>
                ) : (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newCategoryInput}
                      onChange={(e) => setNewCategoryInput(e.target.value)}
                      placeholder="例如 BGP/Policy"
                      className="flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2"
                      style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                      autoFocus
                    />
                    <button
                      onClick={() => { setIsNewCategory(false); setTemplateCategoryInput('') }}
                      className="btn"
                      type="button"
                    >取消</button>
                  </div>
                )
              })()}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowTemplateNameModal(false)}
                className="btn"
              >
                取消
              </button>
              <button
                onClick={() => { void handleTemplateNameSubmit() }}
                className="btn"
                disabled={isSavingTemplate}
              >
                {isSavingTemplate ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
