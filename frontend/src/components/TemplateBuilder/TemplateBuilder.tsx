import { useRef, useState, useCallback, useEffect } from 'react'
import Editor, { OnMount } from '@monaco-editor/react'
import type { editor, IRange, IDisposable } from 'monaco-editor'
import { useStore, getVariableColor, type Variable, type VariableSyntaxMode } from '../../store/useStore'
import { getParameterPlaceholderDecorations } from '../../utils'
import TemplateDirectoryTree from '../TemplateDirectoryTree'
import VariableModal from './VariableModal'
import GroupModal from './GroupModal'
import VariableList from './VariableList'

const VARIABLE_COLORS = Array.from({ length: 12 }, (_, index) => getVariableColor(index))

// Group color palette (distinct from variables)
const GROUP_COLOR = '#f97316'

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
  const [groupSelection, setGroupSelection] = useState<GroupSelection | null>(null)
  const [showTemplateNameModal, setShowTemplateNameModal] = useState(false)
  const [templateNameInput, setTemplateNameInput] = useState('')
  const [templateVendorInput, setTemplateVendorInput] = useState('Unassigned')
  const [templateCategoryInput, setTemplateCategoryInput] = useState('')
  const [isEditorReady, setIsEditorReady] = useState(false)
  const [isSavingTemplate, setIsSavingTemplate] = useState(false)
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
    addGroup,
    removeGroup,
    setTemplateName,
    clearVariables,
    newTemplate,
    patterns,
    savedTemplates,
    saveTemplate,
    loadTemplate,
    deleteTemplate,
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

      newDecorations.push({
        range,
        options: {
          className: `variable-highlight-${index % 12}`,
          inlineClassName: 'inline-variable-highlight',
          inlineClassNameAffectsLetterSpacing: true,
          before: {
            content: v.name,
            inlineClassName: `variable-label variable-label-${index % 12}`,
            cursorStops: monaco.editor.InjectedTextCursorStops.Left
          },
          overviewRuler: {
            color: getVariableColor(v.colorIndex),
            position: monaco.editor.OverviewRulerLane.Center
          }
        }
      })
    })

    // Add group decorations - highlight current start and end lines
    groups.forEach((g) => {
      const lineCount = model.getLineCount()
      if (g.startLine < 1 || g.endLine < 1 || g.startLine > g.endLine || g.startLine > lineCount || g.endLine > lineCount) {
        return
      }

      // Add decoration for the start line (show group start marker)
      newDecorations.push({
        range: new monaco.Range(g.startLine, 1, g.startLine, 1),
        options: {
          isWholeLine: true,
          className: 'group-line-highlight',
          before: {
            content: `<group name="${g.name}">`,
            inlineClassName: 'group-marker group-marker-start',
            cursorStops: monaco.editor.InjectedTextCursorStops.Left
          },
          overviewRuler: {
            color: GROUP_COLOR,
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
            className: 'group-line-highlight',
            after: {
              content: '</group>',
              inlineClassName: 'group-marker group-marker-end',
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
            className: 'group-line-highlight',
            after: {
              content: '</group>',
              inlineClassName: 'group-marker group-marker-end',
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
        background-color: ${GROUP_COLOR}${groupBgOpacity} !important;
        border-left: 3px solid ${GROUP_COLOR} !important;
      }
      .group-marker {
        font-family: var(--font-mono);
        font-size: 12px;
        padding: 0 6px;
        border-radius: 3px;
        font-weight: bold;
      }
      .group-marker-start {
        background-color: ${GROUP_COLOR} !important;
        color: white !important;
        margin-right: 8px;
      }
      .group-marker-end {
        background-color: ${isDark ? '#4a4a5a' : '#94a3b8'} !important;
        color: ${isDark ? '#f97316' : '#ea580c'} !important;
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
      getParameterPlaceholderDecorations(generatedMonacoRef.current, model)
    )
  }, [generatedTemplate])

  // Update editor theme when app theme changes
  useEffect(() => {
    if (monacoRef.current && editorRef.current) {
      monacoRef.current.editor.setTheme(theme === 'dark' ? 'ttp-dark' : 'ttp-light')
    }
    if (generatedMonacoRef.current && generatedEditorRef.current) {
      generatedMonacoRef.current.editor.setTheme(theme === 'dark' ? 'ttp-dark' : 'ttp-light')
    }
  }, [theme])

  // Handle sample editor mount
  const handleEditorMount: OnMount = (editorInstance, monaco) => {
    editorRef.current = editorInstance
    monacoRef.current = monaco

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

        setEditingVariable(null)
        setCurrentSelection({
          text: selectedText,
          startLine: selection.startLineNumber,
          startColumn: selection.startColumn,
          endLine: selection.endLineNumber,
          endColumn: selection.endColumn
        })
        setShowModal(true)
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

        setGroupSelection({
          text: selectedText,
          startLine: selection.startLineNumber,
          endLine: selection.endLineNumber
        })
        setShowGroupModal(true)
      }
    })

    rebuildTrackingDecorations()
    setIsEditorReady(true)
  }

  // Handle generated template editor mount
  const handleGeneratedEditorMount: OnMount = (editorInstance, monaco) => {
    generatedEditorRef.current = editorInstance
    generatedMonacoRef.current = monaco

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
        getParameterPlaceholderDecorations(monaco, model)
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

  const handleGroupCreated = useCallback((name: string) => {
    if (!groupSelection) return

    addGroup({
      name,
      startLine: groupSelection.startLine,
      endLine: groupSelection.endLine
    })

    setShowGroupModal(false)
    setGroupSelection(null)
  }, [groupSelection, addGroup])

  const handleSaveTemplate = useCallback(() => {
    if (variables.length === 0 && groups.length === 0) {
      alert('Please add at least one variable or group')
      return
    }

    setTemplateNameInput(templateName || selectedSavedTemplate?.name || '')
    setTemplateVendorInput(selectedSavedTemplate?.vendor || currentTemplateVendor || 'Unassigned')
    setTemplateCategoryInput((selectedSavedTemplate?.categoryPath || currentTemplateCategoryPath || []).join('/'))
    setShowTemplateNameModal(true)
  }, [variables, groups, templateName, selectedSavedTemplate, currentTemplateVendor, currentTemplateCategoryPath])

  const handleTemplateNameSubmit = useCallback(async () => {
    const name = templateNameInput || 'data'
    const categoryPath = templateCategoryInput.split('/').map((segment) => segment.trim()).filter(Boolean)
    setTemplateName(name)
    setIsSavingTemplate(true)
    try {
      await saveTemplate(name, '', templateVendorInput, categoryPath)
      setShowTemplateNameModal(false)
      setTemplateNameInput('')
      setTemplateVendorInput('Unassigned')
      setTemplateCategoryInput('')
    } finally {
      setIsSavingTemplate(false)
    }
  }, [templateNameInput, templateVendorInput, templateCategoryInput, setTemplateName, saveTemplate])

  const handleLoadTemplate = useCallback(async (id: string) => {
    suppressTrackingSyncRef.current = true
    await loadTemplate(id)
  }, [loadTemplate])

  const handleDeleteTemplate = useCallback(async (id: string) => {
    if (confirm('Delete this template?')) {
      await deleteTemplate(id)
    }
  }, [deleteTemplate])

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Header */}
      <div className="page-header">
        <h2>Template Builder</h2>
        <div className="flex gap-2">
          <button
            onClick={clearVariables}
            className="btn"
            disabled={variables.length === 0 && groups.length === 0}
          >
            Clear
          </button>
          <button
            onClick={newTemplate}
            className="btn"
            disabled={!sampleText && !generatedTemplate && variables.length === 0 && groups.length === 0 && !templateName && !selectedSavedTemplateId}
          >
            New
          </button>
          <button
            onClick={handleSaveTemplate}
            className="btn"
            disabled={variables.length === 0 && groups.length === 0}
          >
            Save
          </button>
        </div>
      </div>

      {/* Main content area - 4 panels */}
      <div className="flex-1 flex min-h-0">
        {/* Left: Saved Templates Sidebar */}
        <div className="w-56 border-r overflow-auto flex-shrink-0" style={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
          <TemplateDirectoryTree
            title="Template Management"
            vendors={vendors}
            categories={parseCategories}
            templates={savedTemplates}
            loading={isLoadingTemplates || isLoadingTemplateDirectories}
            emptyText="No saved templates"
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
          <div className="flex-1 relative border-r" style={{ borderColor: 'var(--border-color)' }}>
            <div className="absolute top-0 left-0 right-0 z-10 px-3 py-2 border-b text-xs font-medium" style={{ backgroundColor: 'var(--bg-header)', borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
              Sample Input
            </div>
            <div className="pt-9 h-full">
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
                  fontSize: 14,
                  fontFamily: 'var(--font-mono)',
                  scrollBeyondLastLine: false,
                  contextmenu: true,
                  automaticLayout: true
                }}
              />
            </div>
            {/* Instructions overlay */}
            {sampleText === '' && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none pt-9">
                <div className="text-center p-8" style={{ color: 'var(--text-muted)' }}>
                  <p className="text-lg mb-2">Enter sample text or load a file</p>
                  <p className="text-sm">Select text, right-click to add variables or groups</p>
                </div>
              </div>
            )}
          </div>

          {/* Generated Template Editor (Right) */}
          <div className="flex-1 relative" style={{ minWidth: '200px' }}>
            <div className="absolute top-0 left-0 right-0 z-10 px-3 py-2 border-b text-xs font-medium flex items-center justify-between" style={{ backgroundColor: 'var(--bg-header)', borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
              <span>Generated Template</span>
              {templateName && <span style={{ color: 'var(--accent-primary)' }}>{templateName}</span>}
            </div>
            <div className="pt-9 h-full">
              {generatedTemplate ? (
                <Editor
                  key={generatedTemplate}
                  height="100%"
                  defaultLanguage="xml"
                  defaultValue={generatedTemplate}
                  onMount={handleGeneratedEditorMount}
                  options={{
                    minimap: { enabled: false },
                    lineNumbers: 'on',
                    wordWrap: 'on',
                    fontSize: 14,
                    fontFamily: 'var(--font-mono)',
                    scrollBeyondLastLine: false,
                    readOnly: true,
                    automaticLayout: true
                  }}
                />
              ) : (
                <div className="h-full flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>
                  <div className="text-center">
                    <p className="text-sm">Add variables/groups</p>
                    <p className="text-sm">and click Save</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: Variable list sidebar */}
        <div className="w-56 border-l overflow-auto flex-shrink-0" style={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
          <VariableList
            variables={variables}
            groups={groups}
            onEditVariable={handleEditVariable}
            onRemoveVariable={removeVariable}
            onRemoveGroup={removeGroup}
          />
        </div>
      </div>

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
          onConfirm={handleGroupCreated}
          onCancel={() => {
            setShowGroupModal(false)
            setGroupSelection(null)
          }}
        />
      )}

      {/* Template Name Modal */}
      {showTemplateNameModal && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'var(--overlay-backdrop)' }}>
          <div className="rounded-lg p-6 w-96 shadow-xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Save Template</h3>
            <input
              type="text"
              value={templateNameInput}
              onChange={(e) => setTemplateNameInput(e.target.value)}
              placeholder="Template name (e.g., interfaces)"
              className="w-full px-3 py-2 border rounded-md mb-3 focus:outline-none focus:ring-2"
              style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
              autoFocus
            />
            <input
              type="text"
              list="template-vendors"
              value={templateVendorInput}
              onChange={(e) => setTemplateVendorInput(e.target.value)}
              placeholder="Vendor"
              className="w-full px-3 py-2 border rounded-md mb-3 focus:outline-none focus:ring-2"
              style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
            />
            <datalist id="template-vendors">
              {vendors.map((vendor) => (
                <option key={vendor.name} value={vendor.name} />
              ))}
            </datalist>
            <input
              type="text"
              value={templateCategoryInput}
              onChange={(e) => setTemplateCategoryInput(e.target.value)}
              placeholder="Folder path (e.g. Core/Interfaces)"
              className="w-full px-3 py-2 border rounded-md mb-4 focus:outline-none focus:ring-2"
              style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowTemplateNameModal(false)}
                className="btn"
              >
                Cancel
              </button>
              <button
                onClick={() => { void handleTemplateNameSubmit() }}
                className="btn"
                disabled={isSavingTemplate}
              >
                {isSavingTemplate ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
