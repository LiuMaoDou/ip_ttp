import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useDropzone } from 'react-dropzone'
import Editor, { OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import BindingSelectorModal from './BindingSelectorModal'
import {
  useStore,
  buildGenerationSourceTemplates,
  type GenerationBinding,
  type GenerationSourceTemplate,
  type SavedTemplate,
  type Variable,
  type Group
} from '../../store/useStore'
import { formatFileSize, getParameterPlaceholderDecorations, sanitizeFileNameSegment } from '../../utils'

interface CurrentSelection {
  text: string
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
}

interface BindableSelector {
  id: string
  label: string
  expression: string
  sourceTemplate: GenerationSourceTemplate
  variableName: string
  groupPath: string[]
}

function createGenerationBindingId() {
  return `genbind-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

function createGenerationFileId() {
  return `genfile-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

function getGeneratedFileName(fileName: string, templateName?: string): string {
  const baseName = fileName.replace(/\.[^/.]+$/, '') || 'generated'
  const suffix = templateName ? `.${sanitizeFileNameSegment(templateName)}` : ''
  return `${baseName}${suffix}.cfg`
}

function getTemplateDownloadName(templateName?: string): string {
  const normalizedName = templateName ? sanitizeFileNameSegment(templateName) : ''
  return normalizedName ? `${normalizedName}.j2` : 'generation-template.j2'
}

function compareGroups(a: Group, b: Group) {
  if (a.startLine !== b.startLine) {
    return a.startLine - b.startLine
  }
  return (b.endLine - b.startLine) - (a.endLine - a.startLine)
}

function getContainingGroups(variable: Variable, groups: Group[]): Group[] {
  return [...groups]
    .filter((group) => variable.startLine >= group.startLine && variable.endLine <= group.endLine)
    .sort(compareGroups)
}

function getExpression(alias: string, groupPath: string[], variableName: string): string {
  const path = [alias, ...groupPath, variableName].join('.')
  return `{{ data.${path} }}`
}

function deriveSourceTemplates(savedTemplates: SavedTemplate[], selectedIds: string[]): GenerationSourceTemplate[] {
  return buildGenerationSourceTemplates(savedTemplates, selectedIds)
}

function deriveBindableSelectors(savedTemplate: SavedTemplate, sourceTemplate: GenerationSourceTemplate): BindableSelector[] {
  const variables = (savedTemplate.variables || []) as unknown as Variable[]
  const groups = (savedTemplate.groups || []) as unknown as Group[]

  return variables.map((variable) => {
    const groupPath = getContainingGroups(variable, groups).map((group) => group.name)
    const selector = [sourceTemplate.templateAlias, ...groupPath, variable.name].join('.')
    return {
      id: `${sourceTemplate.templateId}:${variable.id}`,
      label: selector,
      expression: getExpression(sourceTemplate.templateAlias, groupPath, variable.name),
      sourceTemplate,
      variableName: variable.name,
      groupPath
    }
  })
}

function buildBinding(selection: CurrentSelection, selector: BindableSelector): GenerationBinding {
  return {
    id: createGenerationBindingId(),
    startLine: selection.startLine,
    startColumn: selection.startColumn,
    endLine: selection.endLine,
    endColumn: selection.endColumn,
    originalText: selection.text,
    reference: {
      templateId: selector.sourceTemplate.templateId,
      templateName: selector.sourceTemplate.templateName,
      templateAlias: selector.sourceTemplate.templateAlias,
      groupPath: selector.groupPath,
      variableName: selector.variableName,
      selector: selector.label,
      expression: selector.expression
    }
  }
}

function getBindingExpression(binding: GenerationBinding): string {
  if (binding.reference.expression) {
    return binding.reference.expression
  }

  if (binding.reference.templateAlias && binding.reference.variableName) {
    const path = [binding.reference.templateAlias, ...binding.reference.groupPath, binding.reference.variableName].join('.')
    return `{{ data.${path} }}`
  }

  throw new Error('Binding is missing render expression')
}

function getBindingOffsets(text: string, binding: GenerationBinding): { startOffset: number; endOffset: number } {
  const positions = [binding.startLine, binding.startColumn, binding.endLine, binding.endColumn]
  if (positions.some((value) => !Number.isInteger(value))) {
    throw new Error('Binding positions must be integers')
  }

  if (binding.startLine < 1 || binding.startColumn < 1 || binding.endLine < 1 || binding.endColumn < 1) {
    throw new Error('Binding positions must be positive')
  }

  if (binding.startLine > binding.endLine || (binding.startLine === binding.endLine && binding.startColumn >= binding.endColumn)) {
    throw new Error('Binding range is invalid')
  }

  const lines = text.split('\n')
  if (binding.startLine > lines.length || binding.endLine > lines.length) {
    throw new Error('Binding line range is outside the template text')
  }

  const startLineText = lines[binding.startLine - 1]
  const endLineText = lines[binding.endLine - 1]
  if (binding.startColumn > startLineText.length + 1 || binding.endColumn > endLineText.length + 1) {
    throw new Error('Binding column range is outside the template text')
  }

  const lineOffsets = [0]
  let offset = 0
  lines.slice(0, -1).forEach((line) => {
    offset += line.length + 1
    lineOffsets.push(offset)
  })

  return {
    startOffset: lineOffsets[binding.startLine - 1] + binding.startColumn - 1,
    endOffset: lineOffsets[binding.endLine - 1] + binding.endColumn - 1
  }
}

function applyBindings(text: string, bindings: GenerationBinding[]): string {
  if (bindings.length === 0) {
    return text
  }

  const candidates = bindings
    .flatMap((binding) => {
      const expression = getBindingExpression(binding)
      let offsets: { startOffset: number; endOffset: number }

      try {
        offsets = getBindingOffsets(text, binding)
      } catch (error) {
        if (text.includes(expression)) {
          return []
        }
        throw error
      }

      const selectedText = text.slice(offsets.startOffset, offsets.endOffset)
      if (selectedText === expression) {
        return []
      }

      return [{ ...offsets, expression, binding, selectedText }]
    })
    .sort((a, b) => {
      if (a.startOffset !== b.startOffset) return a.startOffset - b.startOffset
      return a.endOffset - b.endOffset
    })

  for (let index = 1; index < candidates.length; index += 1) {
    if (candidates[index].startOffset < candidates[index - 1].endOffset) {
      throw new Error(
        `Overlapping bindings are not supported: ${candidates[index - 1].binding.reference.selector}, ${candidates[index].binding.reference.selector}`
      )
    }
  }

  const replacements = candidates.flatMap((candidate) => {
    const originalText = candidate.binding.originalText || ''
    if (originalText && candidate.selectedText !== originalText) {
      if (text.includes(candidate.expression)) {
        return []
      }
      throw new Error(`Binding text no longer matches template content: ${candidate.binding.id}`)
    }

    return [candidate]
  })

  let result = text
  for (let index = replacements.length - 1; index >= 0; index -= 1) {
    const replacement = replacements[index]
    result = `${result.slice(0, replacement.startOffset)}${replacement.expression}${result.slice(replacement.endOffset)}`
  }

  return result
}

export default function ConfigGeneration() {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const previewEditorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)
  const bindingDecorationIdsRef = useRef<string[]>([])
  const previewParameterDecorationsRef = useRef<string[]>([])
  const hasLoadedInitialSelectedTemplateRef = useRef(false)
  const isSyncingEditorsRef = useRef(false)
  const [currentSelection, setCurrentSelection] = useState<CurrentSelection | null>(null)
  const [isBindingModalOpen, setIsBindingModalOpen] = useState(false)
  const [templateNameInput, setTemplateNameInput] = useState('')
  const [templateDescriptionInput, setTemplateDescriptionInput] = useState('')
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const {
    generationTemplateText,
    setGenerationTemplateText,
    generationBindings,
    setGenerationBindings,
    generationTemplates,
    saveGenerationTemplate,
    loadGenerationTemplate,
    deleteGenerationTemplate,
    selectedGenerationTemplateId,
    setSelectedGenerationTemplateId,
    selectedGenerationSourceTemplateIds,
    setSelectedGenerationSourceTemplateIds,
    generationUploadedFiles,
    addGenerationUploadedFile,
    removeGenerationUploadedFile,
    selectedGenerationFileId,
    setSelectedGenerationFileId,
    clearGenerationUploadedFiles,
    generationResults,
    selectedGenerationResultIndex,
    setSelectedGenerationResultIndex,
    runGeneration,
    isGeneratingConfig,
    savedTemplates,
    isLoadingGenerationTemplates,
    theme
  } = useStore()

  useEffect(() => {
    if (generationTemplates.length === 0 || !selectedGenerationTemplateId) {
      hasLoadedInitialSelectedTemplateRef.current = true
      return
    }

    if (hasLoadedInitialSelectedTemplateRef.current) {
      return
    }

    const hasSelectedTemplate = generationTemplates.some((template) => template.id === selectedGenerationTemplateId)
    if (!hasSelectedTemplate) {
      hasLoadedInitialSelectedTemplateRef.current = true
      return
    }

    hasLoadedInitialSelectedTemplateRef.current = true
    void loadGenerationTemplate(selectedGenerationTemplateId)
  }, [generationTemplates, loadGenerationTemplate, selectedGenerationTemplateId])

  const sourceTemplates = useMemo(
    () => deriveSourceTemplates(savedTemplates, selectedGenerationSourceTemplateIds),
    [savedTemplates, selectedGenerationSourceTemplateIds]
  )

  const bindableSelectors = useMemo(() => {
    return sourceTemplates.flatMap((sourceTemplate) => {
      const savedTemplate = savedTemplates.find((template) => template.id === sourceTemplate.templateId)
      if (!savedTemplate) {
        return []
      }
      return deriveBindableSelectors(savedTemplate, sourceTemplate)
    })
  }, [savedTemplates, sourceTemplates])

  const selectedGenerationTemplate = useMemo(
    () => generationTemplates.find((template) => template.id === selectedGenerationTemplateId) || null,
    [generationTemplates, selectedGenerationTemplateId]
  )

  useEffect(() => {
    setTemplateNameInput(selectedGenerationTemplate?.name || '')
    setTemplateDescriptionInput(selectedGenerationTemplate?.description || '')
  }, [selectedGenerationTemplate])

  const renderedTemplatePreview = useMemo(() => {
    try {
      return {
        content: applyBindings(generationTemplateText, generationBindings),
        error: null
      }
    } catch (error) {
      return {
        content: generationTemplateText,
        error: error instanceof Error ? error.message : 'Failed to apply bindings'
      }
    }
  }, [generationTemplateText, generationBindings])

  const currentResult = generationResults[selectedGenerationResultIndex] || generationResults[0] || null
  const previewFile = generationUploadedFiles.find((file) => file.id === selectedGenerationFileId) || generationUploadedFiles[0] || null

  const handleEditorMount: OnMount = (editorInstance, monaco) => {
    editorRef.current = editorInstance
    monacoRef.current = monaco

    monaco.editor.defineTheme('ttp-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: { 'editor.background': '#1e1e2e' }
    })

    monaco.editor.defineTheme('ttp-light', {
      base: 'vs',
      inherit: true,
      rules: [],
      colors: { 'editor.background': '#ffffff' }
    })

    monaco.editor.setTheme(theme === 'dark' ? 'ttp-dark' : 'ttp-light')

    editorInstance.addAction({
      id: 'config-generation-add-binding',
      label: 'Bind to Parse Parameter',
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1,
      run: (ed) => {
        const selection = ed.getSelection()
        if (!selection || selection.isEmpty()) {
          return
        }

        const model = ed.getModel()
        if (!model) {
          return
        }

        setCurrentSelection({
          text: model.getValueInRange(selection),
          startLine: selection.startLineNumber,
          startColumn: selection.startColumn,
          endLine: selection.endLineNumber,
          endColumn: selection.endColumn
        })
        setIsBindingModalOpen(true)
      }
    })
  }

  const handlePreviewEditorMount: OnMount = (editorInstance) => {
    previewEditorRef.current = editorInstance

    const model = editorInstance.getModel()
    if (model && monacoRef.current) {
      previewParameterDecorationsRef.current = editorInstance.deltaDecorations(
        previewParameterDecorationsRef.current,
        getParameterPlaceholderDecorations(monacoRef.current, model)
      )
    }
  }

  useEffect(() => {
    const sourceEditor = editorRef.current
    const previewEditor = previewEditorRef.current

    if (!sourceEditor || !previewEditor) {
      return
    }

    const syncEditors = (from: editor.IStandaloneCodeEditor, to: editor.IStandaloneCodeEditor) => {
      if (isSyncingEditorsRef.current) {
        return
      }

      isSyncingEditorsRef.current = true
      to.setScrollTop(from.getScrollTop())
      to.setScrollLeft(from.getScrollLeft())
      isSyncingEditorsRef.current = false
    }

    const sourceScrollDisposable = sourceEditor.onDidScrollChange(() => {
      syncEditors(sourceEditor, previewEditor)
    })

    const previewScrollDisposable = previewEditor.onDidScrollChange(() => {
      syncEditors(previewEditor, sourceEditor)
    })

    syncEditors(sourceEditor, previewEditor)

    return () => {
      sourceScrollDisposable.dispose()
      previewScrollDisposable.dispose()
    }
  }, [renderedTemplatePreview.content])

  useEffect(() => {
    if (monacoRef.current) {
      monacoRef.current.editor.setTheme(theme === 'dark' ? 'ttp-dark' : 'ttp-light')
    }
  }, [theme])

  useEffect(() => {
    if (!previewEditorRef.current || !monacoRef.current) {
      return
    }

    const model = previewEditorRef.current.getModel()
    if (!model) {
      return
    }

    previewParameterDecorationsRef.current = previewEditorRef.current.deltaDecorations(
      previewParameterDecorationsRef.current,
      getParameterPlaceholderDecorations(monacoRef.current, model)
    )
  }, [renderedTemplatePreview.content])

  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) {
      return
    }

    const model = editorRef.current.getModel()
    if (!model) {
      return
    }

    const decorations = generationBindings
      .filter((binding) => binding.startLine === binding.endLine)
      .map((binding) => ({
        range: new monacoRef.current!.Range(
          binding.startLine,
          binding.startColumn,
          binding.endLine,
          binding.endColumn
        ),
        options: {
          inlineClassName: 'config-generation-binding',
          hoverMessage: { value: binding.reference.selector }
        }
      }))

    bindingDecorationIdsRef.current = editorRef.current.deltaDecorations(bindingDecorationIdsRef.current, decorations)
  }, [generationBindings])

  const handleBindingModalCancel = useCallback(() => {
    setCurrentSelection(null)
    setIsBindingModalOpen(false)
  }, [])

  const handleBindingModalConfirm = useCallback((selectorId: string) => {
    if (!currentSelection) {
      return
    }

    const selector = bindableSelectors.find((item) => item.id === selectorId)
    if (!selector) {
      return
    }

    setGenerationBindings((current) => [...current, buildBinding(currentSelection, selector)])
    setCurrentSelection(null)
    setIsBindingModalOpen(false)
  }, [bindableSelectors, currentSelection, setGenerationBindings])

  const removeBinding = (bindingId: string) => {
    setGenerationBindings((current) => current.filter((binding) => binding.id !== bindingId))
  }

  const onDrop = useCallback((acceptedFiles: File[]) => {
    acceptedFiles.forEach((file) => {
      const reader = new FileReader()
      reader.onload = () => {
        const content = reader.result as string
        const fileId = createGenerationFileId()
        addGenerationUploadedFile({
          id: fileId,
          file,
          name: file.name,
          size: file.size,
          content
        })
        setSelectedGenerationFileId(fileId)
      }
      reader.readAsText(file)
    })
  }, [addGenerationUploadedFile, setSelectedGenerationFileId])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/json': ['.json'],
      'text/json': ['.json']
    },
    multiple: true
  })

  const handleTemplateUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }
    const content = await file.text()
    setGenerationTemplateText(content)
  }

  const toggleSourceTemplate = (templateId: string) => {
    setSelectedGenerationSourceTemplateIds((current) => (
      current.includes(templateId)
        ? current.filter((id) => id !== templateId)
        : [...current, templateId]
    ))
  }

  const handleOpenSaveModal = () => {
    setTemplateNameInput(selectedGenerationTemplate?.name || '')
    setTemplateDescriptionInput(selectedGenerationTemplate?.description || '')
    setShowSaveModal(true)
  }

  const handleSave = async () => {
    if (!templateNameInput.trim()) {
      return
    }

    setIsSaving(true)
    try {
      await saveGenerationTemplate(
        templateNameInput.trim(),
        templateDescriptionInput,
        sourceTemplates
      )
      setShowSaveModal(false)
    } finally {
      setIsSaving(false)
    }
  }

  const handleLoad = async (templateId: string) => {
    setSelectedGenerationTemplateId(templateId)
    await loadGenerationTemplate(templateId)
  }

  const handleDelete = async (templateId: string) => {
    await deleteGenerationTemplate(templateId)
  }

  const handleGenerate = async () => {
    await runGeneration({
      name: templateNameInput,
      description: templateDescriptionInput
    })

    const { generationResults: latestResults } = useStore.getState()
    if (latestResults.some((result) => result.success)) {
      alert('配置生成完成')
    }
  }

  const generationTemplateDisplayName = templateNameInput.trim() || selectedGenerationTemplate?.name

  const handleDownloadTemplate = () => {
    if (!generationTemplateText.trim()) {
      return
    }

    const blob = new Blob([generationTemplateText], { type: 'text/plain;charset=utf-8' })
    saveAs(blob, getTemplateDownloadName(generationTemplateDisplayName))
  }

  const handleDownloadSingle = (resultIndex: number) => {
    const result = generationResults[resultIndex]
    if (!result?.success || !result.generatedText) {
      return
    }

    const blob = new Blob([result.generatedText], { type: 'text/plain;charset=utf-8' })
    saveAs(blob, getGeneratedFileName(result.fileName, generationTemplateDisplayName))
  }

  const handleDownloadAll = async () => {
    const successfulResults = generationResults.filter((result) => result.success && typeof result.generatedText === 'string')
    if (successfulResults.length === 0) {
      return
    }

    const zip = new JSZip()
    successfulResults.forEach((result) => {
      zip.file(getGeneratedFileName(result.fileName, generationTemplateDisplayName), result.generatedText || '')
    })

    const content = await zip.generateAsync({ type: 'blob' })
    saveAs(content, 'generated_configs.zip')
  }

  return (
    <>
      {showSaveModal && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="rounded-lg p-6 w-96 shadow-xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Save Template</h3>
            <input
              type="text"
              value={templateNameInput}
              onChange={(event) => setTemplateNameInput(event.target.value)}
              placeholder="Generation template name"
              className="w-full px-3 py-2 border rounded-md mb-3 focus:outline-none focus:ring-2"
              style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
              autoFocus
            />
            <textarea
              value={templateDescriptionInput}
              onChange={(event) => setTemplateDescriptionInput(event.target.value)}
              placeholder="Description"
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
                onClick={() => void handleSave()}
                className="btn"
                disabled={isSaving || !templateNameInput.trim()}
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
      {isBindingModalOpen && currentSelection && (
        <BindingSelectorModal
          selectedText={currentSelection.text}
          options={bindableSelectors.map((selector) => ({
            id: selector.id,
            label: selector.label,
            expression: selector.expression,
            templateName: selector.sourceTemplate.templateName
          }))}
          onConfirm={handleBindingModalConfirm}
          onCancel={handleBindingModalCancel}
        />
      )}
      <div className="flex flex-col h-full text-sm" style={{ backgroundColor: 'var(--bg-primary)', fontSize: '14px' }}>
        <div className="page-header">
        <h2>Config Generation</h2>
        <div className="flex gap-2 items-center">
          <label className="btn cursor-pointer">
            Upload Template
            <input type="file" accept=".txt,.cfg,.conf,.jinja,.j2" className="hidden" onChange={handleTemplateUpload} />
          </label>
          <button
            className="btn"
            onClick={() => void handleOpenSaveModal()}
            disabled={isSaving || !generationTemplateText.trim()}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
          <button
            className="btn"
            onClick={handleDownloadTemplate}
            disabled={!generationTemplateText.trim()}
          >
            Download Template
          </button>
          <button
            className="btn"
            onClick={() => void handleGenerate()}
            disabled={isGeneratingConfig || !generationTemplateText.trim() || generationUploadedFiles.length === 0}
          >
            {isGeneratingConfig ? 'Generating...' : 'Generate'}
          </button>
          <button className="btn" onClick={() => void handleDownloadAll()} disabled={!generationResults.some((result) => result.success && result.generatedText)}>
            Download All
          </button>
        </div>
      </div>

      <div
        className="flex-1 grid min-h-0"
        style={{
          gridTemplateColumns: '14rem minmax(0, 1fr) 14rem',
          gridTemplateRows: 'minmax(0, 1fr) minmax(0, 18rem)'
        }}
      >
        <div className="border-r row-span-2 overflow-auto" style={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
          <div className="p-3 border-b" style={{ borderColor: 'var(--border-color)' }}>
            <h3 className="text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Generation Templates</h3>
            {isLoadingGenerationTemplates ? (
              <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
            ) : generationTemplates.length === 0 ? (
              <p style={{ color: 'var(--text-muted)' }}>No saved generation templates</p>
            ) : (
              <div className="space-y-1">
                {generationTemplates.map((template) => {
                  const isSelected = template.id === selectedGenerationTemplateId
                  return (
                    <div
                      key={template.id}
                      className="p-2 rounded border cursor-pointer"
                      style={{
                        borderColor: isSelected ? 'var(--accent-primary)' : 'var(--border-color)',
                        backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.12)' : 'transparent'
                      }}
                      onClick={() => void handleLoad(template.id)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate">{template.name}</span>
                        <button
                          className="text-xs"
                          onClick={(event) => {
                            event.stopPropagation()
                            void handleDelete(template.id)
                          }}
                          style={{ color: 'var(--text-muted)' }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="p-3">
            <h3 className="text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Parse Templates</h3>
            <div className="space-y-1 max-h-64 overflow-auto">
              {savedTemplates.map((template) => {
                const checked = selectedGenerationSourceTemplateIds.includes(template.id)
                return (
                  <label key={template.id} className="flex items-start gap-2 p-2 rounded cursor-pointer" style={{ backgroundColor: checked ? 'rgba(59, 130, 246, 0.12)' : 'transparent' }}>
                    <input type="checkbox" checked={checked} onChange={() => toggleSourceTemplate(template.id)} className="mt-1" />
                    <div className="min-w-0">
                      <div className="truncate">{template.name}</div>
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{template.description || 'No description'}</div>
                    </div>
                  </label>
                )
              })}
            </div>
          </div>
        </div>

        <div
          className="border-r grid min-h-0"
          style={{
            borderColor: 'var(--border-color)',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)'
          }}
        >
          <div className="flex flex-col min-h-0">
            <div className="p-3 border-b text-xs min-h-[58px] flex items-center" style={{ borderColor: 'var(--border-color)', color: 'var(--text-muted)' }}>
              在模板中选中文本后右键，选择 <span style={{ color: 'var(--text-primary)' }}>Bind to Parse Parameter</span>
            </div>

            <div className="flex-1 min-h-0">
              <Editor
                height="100%"
                defaultLanguage="plaintext"
                value={generationTemplateText}
                onChange={(value) => setGenerationTemplateText(value || '')}
                onMount={handleEditorMount}
                options={{
                  minimap: { enabled: false },
                  lineNumbers: 'on',
                  wordWrap: 'off',
                  fontSize: 14,
                  fontFamily: 'var(--font-mono)',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  lineNumbersMinChars: 3,
                  scrollbar: {
                    alwaysConsumeMouseWheel: false
                  }
                }}
              />
            </div>
          </div>

          <div className="border-l flex flex-col min-h-0" style={{ borderColor: 'var(--border-color)' }}>
            <div className="p-3 border-b text-xs min-h-[58px] flex items-center" style={{ borderColor: 'var(--border-color)', color: 'var(--text-muted)' }}>
              <h3 className="text-xs font-normal" style={{ color: 'var(--text-muted)' }}>Rendered Template Preview</h3>
            </div>
            <div className="flex-1 min-h-0">
              <Editor
                height="100%"
                defaultLanguage="plaintext"
                value={renderedTemplatePreview.content || 'No template content'}
                onMount={handlePreviewEditorMount}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  lineNumbers: 'on',
                  wordWrap: 'off',
                  fontSize: 14,
                  fontFamily: 'var(--font-mono)',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  renderLineHighlight: 'none',
                  overviewRulerLanes: 0,
                  occurrencesHighlight: 'off',
                  selectionHighlight: false,
                  glyphMargin: false,
                  folding: false,
                  lineDecorationsWidth: 10,
                  lineNumbersMinChars: 3,
                  scrollbar: {
                    alwaysConsumeMouseWheel: false
                  }
                }}
              />
            </div>
          </div>
        </div>

        <div className="row-span-2 flex flex-col min-h-0" style={{ backgroundColor: 'var(--bg-secondary)' }}>
          <div className="p-3 border-b" style={{ borderColor: 'var(--border-color)' }}>
            <h3 className="text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Bindings</h3>
            <div className="space-y-2 max-h-56 overflow-auto">
              {generationBindings.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>No bindings yet.</p>
              ) : generationBindings.map((binding) => (
                <div key={binding.id} className="p-2 rounded border" style={{ borderColor: 'var(--border-color)' }}>
                  <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{binding.originalText}</div>
                  <div className="text-sm break-all">{binding.reference.selector}</div>
                  <div className="text-xs break-all mt-1" style={{ color: 'var(--accent-primary)' }}>{binding.reference.expression}</div>
                  <button className="mt-2 text-xs" style={{ color: 'var(--error)' }} onClick={() => removeBinding(binding.id)}>Remove</button>
                </div>
              ))}
            </div>
          </div>

          <div className="p-3 border-b" style={{ borderColor: 'var(--border-color)' }}>
            <h3 className="text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Parsed JSON Upload</h3>
            <div
              {...getRootProps()}
              className="p-4 border-2 border-dashed rounded-lg cursor-pointer transition-colors"
              style={{
                borderColor: isDragActive ? '#3b82f6' : 'var(--border-color)',
                backgroundColor: isDragActive ? 'rgba(59, 130, 246, 0.1)' : 'transparent'
              }}
            >
              <input {...getInputProps()} />
              <p className="text-sm text-center" style={{ color: 'var(--text-secondary)' }}>
                {isDragActive ? 'Drop JSON files here' : 'Drop JSON files or click'}
              </p>
            </div>
            <div className="mt-2 space-y-1 max-h-32 overflow-auto">
              {generationUploadedFiles.map((file) => {
                const isSelected = file.id === selectedGenerationFileId
                return (
                  <div
                    key={file.id}
                    className="p-2 rounded border cursor-pointer flex items-center justify-between gap-2"
                    style={{
                      borderColor: isSelected ? 'var(--accent-primary)' : 'var(--border-color)',
                      backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.12)' : 'transparent'
                    }}
                    onClick={() => setSelectedGenerationFileId(file.id)}
                  >
                    <div className="min-w-0">
                      <div className="truncate">{file.name}</div>
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatFileSize(file.size)}</div>
                    </div>
                    <button
                      className="text-xs"
                      onClick={(event) => {
                        event.stopPropagation()
                        removeGenerationUploadedFile(file.id)
                      }}
                    >
                      Remove
                    </button>
                  </div>
                )
              })}
            </div>
            <div className="mt-2 flex gap-2">
              <button className="btn" onClick={clearGenerationUploadedFiles} disabled={generationUploadedFiles.length === 0}>Clear Files</button>
            </div>
            {previewFile && (
              <pre className="mt-3 text-xs whitespace-pre-wrap rounded p-3 overflow-auto max-h-40" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}>
                {previewFile.content}
              </pre>
            )}
          </div>

          <div className="p-3 flex-1 min-h-0 overflow-auto">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Generation Results</h3>
              {currentResult?.success && currentResult.generatedText && (
                <button className="btn" onClick={() => handleDownloadSingle(selectedGenerationResultIndex)}>
                  Download Current
                </button>
              )}
            </div>
            <div className="space-y-1 mb-3">
              {generationResults.map((result, index) => (
                <button
                  key={`${result.fileName}-${index}`}
                  className="w-full text-left p-2 rounded border"
                  style={{
                    borderColor: selectedGenerationResultIndex === index ? 'var(--accent-primary)' : 'var(--border-color)',
                    backgroundColor: selectedGenerationResultIndex === index ? 'rgba(59, 130, 246, 0.12)' : 'transparent'
                  }}
                  onClick={() => setSelectedGenerationResultIndex(index)}
                >
                  <div className="truncate">{result.fileName}</div>
                  <div className="text-xs" style={{ color: result.success ? 'var(--success)' : 'var(--error)' }}>
                    {result.success ? 'Generated' : result.error || 'Failed'}
                  </div>
                </button>
              ))}
            </div>
            <pre className="text-xs whitespace-pre-wrap rounded p-3 overflow-auto" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', minHeight: '8rem' }}>
              {currentResult
                ? currentResult.success
                  ? currentResult.generatedText
                  : `${currentResult.errorType || 'Error'}: ${currentResult.error || 'Unknown error'}`
                : 'No generation results yet.'}
            </pre>
          </div>
        </div>
        </div>
      </div>
    </>
  )
}
