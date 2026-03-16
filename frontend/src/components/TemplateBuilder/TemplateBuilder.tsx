import { useRef, useState, useCallback, useEffect } from 'react'
import Editor, { OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { useStore, getVariableColor } from '../../store/useStore'
import VariableModal from './VariableModal'
import GroupModal from './GroupModal'
import VariableList from './VariableList'

// Variable color palette
const VARIABLE_COLORS = [
  '#3b82f6', '#22c55e', '#a855f7', '#f59e0b', '#ef4444', '#06b6d4',
  '#ec4899', '#84cc16', '#6366f1', '#14b8a6', '#f97316', '#8b5cf6'
]

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

export default function TemplateBuilder() {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)
  const decorationsRef = useRef<string[]>([])
  const generatedEditorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const generatedMonacoRef = useRef<typeof import('monaco-editor') | null>(null)

  const [showModal, setShowModal] = useState(false)
  const [showGroupModal, setShowGroupModal] = useState(false)
  const [currentSelection, setCurrentSelection] = useState<CurrentSelection | null>(null)
  const [groupSelection, setGroupSelection] = useState<GroupSelection | null>(null)
  const [showTemplateNameModal, setShowTemplateNameModal] = useState(false)
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [templateNameInput, setTemplateNameInput] = useState('')
  const [templateDescInput, setTemplateDescInput] = useState('')
  const [isEditorReady, setIsEditorReady] = useState(false)
  const [isSavingTemplate, setIsSavingTemplate] = useState(false)
  const [isDeletingTemplateId, setIsDeletingTemplateId] = useState<string | null>(null)

  const {
    sampleText,
    setSampleText,
    variables,
    groups,
    generatedTemplate,
    addVariable,
    removeVariable,
    addGroup,
    removeGroup,
    setTemplateName,
    clearVariables,
    patterns,
    savedTemplates,
    saveTemplate,
    loadTemplate,
    deleteTemplate,
    templateName,
    selectedSavedTemplateId,
    isLoadingTemplates,
    theme
  } = useStore()

  // Function to apply decorations
  const applyDecorations = useCallback(() => {
    if (!editorRef.current || !monacoRef.current) return

    const monaco = monacoRef.current
    const editor = editorRef.current
    const model = editor.getModel()
    if (!model) return

    if (variables.length === 0 && groups.length === 0) {
      decorationsRef.current = editor.deltaDecorations(decorationsRef.current, [])
      return
    }

    const newDecorations: editor.IModelDeltaDecoration[] = []

    // Add variable decorations
    variables.forEach((v, index) => {
      newDecorations.push({
        range: new monaco.Range(
          v.startLine,
          v.startColumn,
          v.endLine,
          v.endColumn
        ),
        options: {
          className: `variable-highlight-${index % 12}`,
          inlineClassName: `inline-variable-highlight`,
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

    // Add group decorations - highlight entire line range
    groups.forEach((g) => {
      const lineCount = model.getLineCount()

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
      if (g.endLine <= lineCount && g.endLine !== g.startLine) {
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
      } else if (g.endLine === g.startLine) {
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

    decorationsRef.current = editor.deltaDecorations(
      decorationsRef.current,
      newDecorations
    )
  }, [variables, groups])

  // Update decorations when variables, sampleText change, or editor becomes ready
  useEffect(() => {
    if (!isEditorReady) return

    const styleId = 'ttp-variable-styles'
    let styleEl = document.getElementById(styleId)
    if (!styleEl) {
      styleEl = document.createElement('style')
      styleEl.id = styleId
      document.head.appendChild(styleEl)
    }

    // Different styles for light vs dark theme
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
        font-family: Consolas, Monaco, monospace;
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

    const timer = setTimeout(() => {
      applyDecorations()
    }, 100)

    return () => clearTimeout(timer)
  }, [isEditorReady, variables, groups, sampleText, applyDecorations, theme])

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
  }

  const handleVariableCreated = useCallback((
    name: string,
    pattern: string,
    indicators: string[],
    syntaxMode: 'variable' | 'ignore' | 'headers' | 'end',
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

    setShowModal(false)
    setCurrentSelection(null)
  }, [currentSelection, addVariable])

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

  const handleGenerateTemplate = useCallback(() => {
    if (variables.length === 0 && groups.length === 0) {
      alert('Please add at least one variable or group')
      return
    }
    setShowTemplateNameModal(true)
    setTemplateNameInput(templateName || '')
  }, [variables, groups, templateName])

  const handleSaveTemplate = useCallback(async () => {
    if (variables.length === 0 && groups.length === 0) {
      alert('Please add at least one variable or group')
      return
    }

    if (templateName) {
      setIsSavingTemplate(true)
      try {
        await saveTemplate(templateName, '')
      } finally {
        setIsSavingTemplate(false)
      }
    } else {
      setTemplateNameInput('')
      setTemplateDescInput('')
      setShowSaveModal(true)
    }
  }, [variables, groups, templateName, saveTemplate])

  const handleSaveSubmit = useCallback(async () => {
    const name = templateNameInput || 'untitled'
    setIsSavingTemplate(true)
    try {
      await saveTemplate(name, templateDescInput)
      setShowSaveModal(false)
      setTemplateNameInput('')
      setTemplateDescInput('')
    } finally {
      setIsSavingTemplate(false)
    }
  }, [templateNameInput, templateDescInput, saveTemplate])

  const handleTemplateNameSubmit = useCallback(async () => {
    const name = templateNameInput || 'data'
    setTemplateName(name)
    setIsSavingTemplate(true)
    try {
      await saveTemplate(name, templateDescInput)
      setShowTemplateNameModal(false)
      setTemplateNameInput('')
      setTemplateDescInput('')
    } finally {
      setIsSavingTemplate(false)
    }
  }, [templateNameInput, templateDescInput, setTemplateName, saveTemplate])

  const handleLoadTemplate = useCallback(async (id: string) => {
    await loadTemplate(id)
  }, [loadTemplate])

  const handleDeleteTemplate = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirm('Delete this template?')) {
      setIsDeletingTemplateId(id)
      try {
        await deleteTemplate(id)
      } finally {
        setIsDeletingTemplateId(null)
      }
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
            onClick={() => { void handleSaveTemplate() }}
            className="btn"
            disabled={isSavingTemplate || (variables.length === 0 && groups.length === 0)}
          >
            {isSavingTemplate ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={handleGenerateTemplate}
            className="btn"
            disabled={variables.length === 0 && groups.length === 0}
          >
            Generate
          </button>
        </div>
      </div>

      {/* Main content area - 4 panels */}
      <div className="flex-1 flex min-h-0">
        {/* Left: Saved Templates Sidebar */}
        <div className="w-56 border-r overflow-auto flex-shrink-0" style={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
          <div className="p-2">
            <h3 className="text-sm font-medium mb-2 px-2" style={{ color: 'var(--text-secondary)' }}>Saved Templates ({savedTemplates.length})</h3>
            {isLoadingTemplates ? (
              <p className="text-xs px-2 py-4 text-center" style={{ color: 'var(--text-muted)' }}>Loading templates...</p>
            ) : savedTemplates.length === 0 ? (
              <p className="text-xs px-2 py-4 text-center" style={{ color: 'var(--text-muted)' }}>No saved templates</p>
            ) : (
              <div className="space-y-1">
                {savedTemplates.map((tpl) => {
                  const isSelected = selectedSavedTemplateId === tpl.id
                  const isDeleting = isDeletingTemplateId === tpl.id

                  return (
                    <div
                      key={tpl.id}
                      onClick={() => { void handleLoadTemplate(tpl.id) }}
                      className="p-2 rounded-md cursor-pointer group transition-colors"
                      style={{
                        backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                        border: isSelected ? '1px solid rgba(59, 130, 246, 0.5)' : '1px solid transparent',
                        opacity: isDeleting ? 0.6 : 1
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) {
                          e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) {
                          e.currentTarget.style.backgroundColor = 'transparent'
                        }
                      }}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{tpl.name}</p>
                          <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{tpl.description || 'No description'}</p>
                          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                            {tpl.variables.length} variables{(tpl.groups?.length || 0) > 0 && `, ${tpl.groups?.length} groups`}
                          </p>
                        </div>
                        <button
                          onClick={(e) => { void handleDeleteTemplate(tpl.id, e) }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity ml-1"
                          style={{ color: 'var(--text-muted)' }}
                          disabled={isDeleting}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Center: Sample Input + Generated Template (side by side) */}
        <div className="flex-1 flex min-w-0">
          {/* Sample Input Editor (Left) */}
          <div className="flex-1 relative border-r" style={{ borderColor: 'var(--border-color)' }}>
            <div className="absolute top-0 left-0 right-0 z-10 px-3 py-1 border-b text-xs font-medium" style={{ backgroundColor: 'var(--bg-header)', borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
              Sample Input
            </div>
            <div className="pt-7 h-full">
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
                  fontFamily: 'Consolas, Monaco, monospace',
                  scrollBeyondLastLine: false,
                  contextmenu: true,
                  automaticLayout: true
                }}
              />
            </div>
            {/* Instructions overlay */}
            {sampleText === '' && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none pt-7">
                <div className="text-center p-8" style={{ color: 'var(--text-muted)' }}>
                  <p className="text-lg mb-2">Enter sample text or load a file</p>
                  <p className="text-sm">Select text, right-click to add variables or groups</p>
                </div>
              </div>
            )}
          </div>

          {/* Generated Template Editor (Right) */}
          <div className="flex-1 relative" style={{ minWidth: '200px' }}>
            <div className="absolute top-0 left-0 right-0 z-10 px-3 py-1 border-b text-xs font-medium flex items-center justify-between" style={{ backgroundColor: 'var(--bg-header)', borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
              <span>Generated Template</span>
              {templateName && <span style={{ color: 'var(--accent-primary)' }}>{templateName}</span>}
            </div>
            <div className="pt-7 h-full">
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
                    fontFamily: 'Consolas, Monaco, monospace',
                    scrollBeyondLastLine: false,
                    readOnly: true,
                    automaticLayout: true
                  }}
                />
              ) : (
                <div className="h-full flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>
                  <div className="text-center">
                    <p className="text-sm">Add variables/groups</p>
                    <p className="text-sm">and click Generate</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: Variable list sidebar */}
        <div className="w-64 border-l overflow-auto flex-shrink-0" style={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
          <VariableList
            variables={variables}
            groups={groups}
            onRemoveVariable={removeVariable}
            onRemoveGroup={removeGroup}
          />
        </div>
      </div>

      {/* Variable Modal */}
      {showModal && currentSelection && (
        <VariableModal
          selectedText={currentSelection.text}
          patterns={patterns}
          onConfirm={handleVariableCreated}
          onCancel={() => {
            setShowModal(false)
            setCurrentSelection(null)
          }}
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
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="rounded-lg p-6 w-96 shadow-xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Generate Template</h3>
            <input
              type="text"
              value={templateNameInput}
              onChange={(e) => setTemplateNameInput(e.target.value)}
              placeholder="Template name (e.g., interfaces)"
              className="w-full px-3 py-2 border rounded-md mb-3 focus:outline-none focus:ring-2"
              style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
              autoFocus
            />
            <textarea
              value={templateDescInput}
              onChange={(e) => setTemplateDescInput(e.target.value)}
              placeholder="Description (optional)"
              className="w-full px-3 py-2 border rounded-md mb-4 h-20 resize-none focus:outline-none focus:ring-2"
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
                {isSavingTemplate ? 'Saving...' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save Template Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="rounded-lg p-6 w-96 shadow-xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Save Template</h3>
            <input
              type="text"
              value={templateNameInput}
              onChange={(e) => setTemplateNameInput(e.target.value)}
              placeholder="Template name (e.g., interface-parser)"
              className="w-full px-3 py-2 border rounded-md mb-3 focus:outline-none focus:ring-2"
              style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
              autoFocus
            />
            <textarea
              value={templateDescInput}
              onChange={(e) => setTemplateDescInput(e.target.value)}
              placeholder="Description (optional)"
              className="w-full px-3 py-2 border rounded-md mb-4 h-20 resize-none focus:outline-none focus:ring-2"
              style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowSaveModal(false)}
                className="btn"
              >
                Cancel
              </button>
              <button
                onClick={() => { void handleSaveSubmit() }}
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
