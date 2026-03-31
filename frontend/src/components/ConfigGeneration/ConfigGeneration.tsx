import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useDropzone } from 'react-dropzone'
import Editor, { OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import TemplateDirectoryTree from '../TemplateDirectoryTree'
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
import { getParameterPlaceholderDecorations, sanitizeFileNameSegment } from '../../utils'

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
  templateLabel: string
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

function getSampleJsonDownloadName(): string {
  return 'sample-generation-input.json'
}

function UploadedJsonIcon() {
  return (
    <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 3.75h7.879a2 2 0 011.414.586l2.371 2.371A2 2 0 0119.25 8.12V18.25A2.75 2.75 0 0116.5 21h-9A2.75 2.75 0 014.75 18.25v-11.75A2.75 2.75 0 017.5 3.75z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8.75 11.25h6.5M8.75 15.25h5" />
    </svg>
  )
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
      templateLabel: [savedTemplate.vendor, ...(savedTemplate.categoryPath || []), savedTemplate.name].filter(Boolean).join(' / '),
      variableName: variable.name,
      groupPath
    }
  })
}

function getSampleValue(variableName: string): string {
  const normalizedName = variableName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

  return `sample_${normalizedName || 'value'}`
}

function ensureObjectPath(root: Record<string, unknown>, path: string[]): Record<string, unknown> {
  return path.reduce<Record<string, unknown>>((current, segment) => {
    if (!segment) {
      return current
    }

    const existing = current[segment]
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      current[segment] = {}
    }

    return current[segment] as Record<string, unknown>
  }, root)
}

function buildTemplateSample(savedTemplate: SavedTemplate, sourceTemplate: GenerationSourceTemplate): Record<string, unknown> {
  const variables = (savedTemplate.variables || []) as unknown as Variable[]
  const groups = (savedTemplate.groups || []) as unknown as Group[]
  const sample: Record<string, unknown> = {}

  variables.forEach((variable) => {
    if ((variable.syntaxMode || 'variable') !== 'variable' || !variable.name?.trim()) {
      return
    }

    const groupPath = getContainingGroups(variable, groups).map((group) => group.name)
    const parent = ensureObjectPath(sample, groupPath)
    if (parent[variable.name] === undefined) {
      parent[variable.name] = getSampleValue(variable.name)
    }
  })

  return { [sourceTemplate.templateAlias]: sample }
}

function mergeBindingPathsIntoSample(
  sample: Record<string, unknown>,
  bindings: GenerationBinding[]
) {
  bindings.forEach((binding) => {
    const alias = binding.reference.templateAlias?.trim()
    const variableName = binding.reference.variableName?.trim()

    if (!alias) {
      return
    }

    if (!sample[alias] || typeof sample[alias] !== 'object' || Array.isArray(sample[alias])) {
      sample[alias] = {}
    }

    if (!variableName) {
      return
    }

    const parent = ensureObjectPath(
      sample[alias] as Record<string, unknown>,
      binding.reference.groupPath || []
    )

    if (parent[variableName] === undefined) {
      parent[variableName] = getSampleValue(variableName)
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
  const [templateVendorInput, setTemplateVendorInput] = useState('Unassigned')
  const [templateCategoryInput, setTemplateCategoryInput] = useState('')
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [showTemplateSelector, setShowTemplateSelector] = useState(false)
  const [showBindingsPanel, setShowBindingsPanel] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isNewVendor, setIsNewVendor] = useState(false)
  const [newVendorInput, setNewVendorInput] = useState('')
  const [isNewCategory, setIsNewCategory] = useState(false)
  const [newCategoryInput, setNewCategoryInput] = useState('')
  const [generateStatus, setGenerateStatus] = useState<{ ok: boolean; msg: string } | null>(null)

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
    currentGenerationTemplateVendor,
    currentGenerationTemplateCategoryPath,
    setCurrentGenerationTemplateDirectory,
    generationUploadedFiles,
    addGenerationUploadedFile,
    removeGenerationUploadedFile,
    selectedGenerationFileId,
    setSelectedGenerationFileId,
    clearGenerationUploadedFiles,
    generationResults,
    runGeneration,
    isGeneratingConfig,
    savedTemplates,
    isLoadingGenerationTemplates,
    isLoadingTemplateDirectories,
    vendors,
    parseCategories,
    generationCategories,
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
  const totalParseTemplateOptions = savedTemplates.length

  const bindableSelectors = useMemo(() => {
    return sourceTemplates.flatMap((sourceTemplate) => {
      const savedTemplate = savedTemplates.find((template) => template.id === sourceTemplate.templateId)
      if (!savedTemplate) {
        return []
      }
      return deriveBindableSelectors(savedTemplate, sourceTemplate)
    })
  }, [savedTemplates, sourceTemplates])

  const canDownloadSampleJson = sourceTemplates.length > 0 || generationBindings.length > 0

  const selectedGenerationTemplate = useMemo(
    () => generationTemplates.find((template) => template.id === selectedGenerationTemplateId) || null,
    [generationTemplates, selectedGenerationTemplateId]
  )

  useEffect(() => {
    setTemplateNameInput(selectedGenerationTemplate?.name || '')
    setTemplateVendorInput(selectedGenerationTemplate?.vendor || currentGenerationTemplateVendor || 'Unassigned')
    setTemplateCategoryInput((selectedGenerationTemplate?.categoryPath || currentGenerationTemplateCategoryPath || []).join('/'))
  }, [selectedGenerationTemplate, currentGenerationTemplateVendor, currentGenerationTemplateCategoryPath])

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

    // Re-apply binding decorations after editor mounts (e.g. after tab switch)
    const currentBindings = useStore.getState().generationBindings
    if (currentBindings.length > 0) {
      const decorations = currentBindings
        .filter((binding) => binding.startLine === binding.endLine)
        .map((binding) => ({
          range: new monaco.Range(
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
      bindingDecorationIdsRef.current = editorInstance.deltaDecorations([], decorations)
    }
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

  const handleSelectAllSourceTemplates = () => {
    const allTemplateIds = savedTemplates.map((template) => template.id)
    if (allTemplateIds.length === 0) {
      return
    }

    const isAllSelected =
      selectedGenerationSourceTemplateIds.length === allTemplateIds.length &&
      allTemplateIds.every((templateId) => selectedGenerationSourceTemplateIds.includes(templateId))

    setSelectedGenerationSourceTemplateIds(isAllSelected ? [] : allTemplateIds)
  }

  const handleOpenSaveModal = () => {
    setTemplateNameInput(selectedGenerationTemplate?.name || '')
    setTemplateVendorInput(selectedGenerationTemplate?.vendor || currentGenerationTemplateVendor || 'Unassigned')
    setTemplateCategoryInput((selectedGenerationTemplate?.categoryPath || currentGenerationTemplateCategoryPath || []).join('/'))
    setIsNewVendor(false)
    setNewVendorInput('')
    setIsNewCategory(false)
    setNewCategoryInput('')
    setShowSaveModal(true)
  }

  const handleNewTemplate = useCallback(() => {
    setGenerationTemplateText('')
    setGenerationBindings([])
    setSelectedGenerationTemplateId(null)
    setSelectedGenerationSourceTemplateIds([])
    setCurrentGenerationTemplateDirectory('Unassigned', [])
    setTemplateNameInput('')
    setTemplateVendorInput('Unassigned')
    setTemplateCategoryInput('')
    setIsNewVendor(false)
    setNewVendorInput('')
    setIsNewCategory(false)
    setNewCategoryInput('')
    setShowSaveModal(false)
    setGenerateStatus(null)
  }, [
    setCurrentGenerationTemplateDirectory,
    setGenerationBindings,
    setGenerationTemplateText,
    setSelectedGenerationSourceTemplateIds,
    setSelectedGenerationTemplateId
  ])

  const handleSave = async () => {
    if (!templateNameInput.trim()) {
      return
    }

    const finalVendor = isNewVendor ? (newVendorInput.trim() || 'Unassigned') : templateVendorInput
    const finalCategoryStr = isNewCategory ? newCategoryInput : templateCategoryInput
    const categoryPath = finalCategoryStr.split('/').map((segment) => segment.trim()).filter(Boolean)

    setIsSaving(true)
    try {
      await saveGenerationTemplate(
        templateNameInput.trim(),
        '',
        finalVendor,
        categoryPath,
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
    setGenerateStatus(null)
    await runGeneration({
      name: templateNameInput,
      description: ''
    })

    const { generationResults: latestResults } = useStore.getState()
    const successCount = latestResults.filter((r) => r.success).length
    const failCount = latestResults.filter((r) => !r.success).length

    if (latestResults.length === 0) {
      setGenerateStatus({ ok: false, msg: 'No files to generate.' })
    } else if (failCount === 0) {
      setGenerateStatus({ ok: true, msg: `Generated ${successCount} file${successCount !== 1 ? 's' : ''}.` })
    } else if (successCount === 0) {
      const firstError = latestResults.find((r) => !r.success)
      setGenerateStatus({ ok: false, msg: firstError?.error ?? 'Generation failed.' })
    } else {
      setGenerateStatus({ ok: true, msg: `${successCount} succeeded, ${failCount} failed.` })
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

  const handleDownloadSampleJson = useCallback(() => {
    if (!canDownloadSampleJson) {
      return
    }

    const samplePayload = sourceTemplates.reduce<Record<string, unknown>>((current, sourceTemplate) => {
      const savedTemplate = savedTemplates.find((template) => template.id === sourceTemplate.templateId)
      if (!savedTemplate) {
        current[sourceTemplate.templateAlias] = {}
        return current
      }

      Object.assign(current, buildTemplateSample(savedTemplate, sourceTemplate))
      return current
    }, {})

    mergeBindingPathsIntoSample(samplePayload, generationBindings)

    const blob = new Blob([JSON.stringify(samplePayload, null, 2)], {
      type: 'application/json;charset=utf-8'
    })
    saveAs(blob, getSampleJsonDownloadName())
  }, [canDownloadSampleJson, generationBindings, savedTemplates, sourceTemplates])

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
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'var(--overlay-backdrop)' }} onClick={(e) => { if (e.target === e.currentTarget) setShowSaveModal(false) }}>
          <div className="rounded-lg p-6 w-96 shadow-xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Save Template</h3>
            <div className="mb-3">
              <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Name</div>
              <input
                type="text"
                value={templateNameInput}
                onChange={(event) => setTemplateNameInput(event.target.value)}
                placeholder="e.g., BGP Base Config"
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2"
                style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                autoFocus
              />
            </div>
            {/* Vendor selector */}
            <div className="mb-3">
              <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Vendor</div>
              {!isNewVendor ? (
                <select
                  value={templateVendorInput}
                  onChange={(event) => {
                    if (event.target.value === '__new__') {
                      setIsNewVendor(true)
                      setNewVendorInput('')
                      setTemplateCategoryInput('')
                      setIsNewCategory(false)
                      setNewCategoryInput('')
                    } else {
                      setTemplateVendorInput(event.target.value)
                      setTemplateCategoryInput('')
                      setIsNewCategory(false)
                      setNewCategoryInput('')
                    }
                  }}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2"
                  style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                >
                  <option value="Unassigned">Unassigned</option>
                  {vendors.map((vendor) => (
                    <option key={vendor.name} value={vendor.name}>{vendor.name}</option>
                  ))}
                  <option value="__new__">+ New vendor...</option>
                </select>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newVendorInput}
                    onChange={(event) => setNewVendorInput(event.target.value)}
                    placeholder="New vendor name"
                    className="flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2"
                    style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                    autoFocus
                  />
                  <button onClick={() => { setIsNewVendor(false) }} className="btn" type="button">Cancel</button>
                </div>
              )}
            </div>
            {/* Folder selector */}
            <div className="mb-4">
              <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Folder</div>
              {(() => {
                const activeVendor = isNewVendor ? newVendorInput.trim() : templateVendorInput
                const vendorCategories = generationCategories.filter((cat) => cat.vendor === activeVendor)
                return !isNewCategory ? (
                  <select
                    value={templateCategoryInput}
                    onChange={(event) => {
                      if (event.target.value === '__new__') {
                        setIsNewCategory(true)
                        setNewCategoryInput('')
                      } else {
                        setTemplateCategoryInput(event.target.value)
                      }
                    }}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2"
                    style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                  >
                    <option value="">No folder (top level)</option>
                    {vendorCategories.map((cat) => (
                      <option key={cat.id} value={cat.path.join('/')}>{cat.path.join('/')}</option>
                    ))}
                    <option value="__new__">+ New folder path...</option>
                  </select>
                ) : (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newCategoryInput}
                      onChange={(event) => setNewCategoryInput(event.target.value)}
                      placeholder="e.g. BGP/Policy"
                      className="flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2"
                      style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                      autoFocus
                    />
                    <button onClick={() => { setIsNewCategory(false); setTemplateCategoryInput('') }} className="btn" type="button">Cancel</button>
                  </div>
                )
              })()}
            </div>
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
            templateName: selector.templateLabel
          }))}
          onConfirm={handleBindingModalConfirm}
          onCancel={handleBindingModalCancel}
        />
      )}
      <div className="flex flex-col h-full text-sm relative" style={{ backgroundColor: 'var(--bg-primary)', fontSize: '14px' }}>
        <div className="page-header">
          <div className="flex items-center gap-3 min-w-0">
            <h2>Config Generation</h2>
            <div
              className="h-5 border-l border-dashed"
              style={{ borderColor: 'var(--border-color)' }}
            />
            <button
              onClick={() => setShowTemplateSelector(true)}
              className="btn"
            >
              Templates
            </button>
            <span className="text-sm truncate" style={{ color: 'var(--text-muted)' }}>
              {selectedGenerationSourceTemplateIds.length}/{totalParseTemplateOptions} selected
            </span>
          </div>
          <div className="flex gap-2 items-center">
            <label className="btn cursor-pointer">
              Upload Template
              <input type="file" accept=".txt,.cfg,.conf,.jinja,.j2" className="hidden" onChange={handleTemplateUpload} />
            </label>
            <button
              className="btn"
              onClick={handleNewTemplate}
              disabled={!generationTemplateText.trim() && generationBindings.length === 0 && !selectedGenerationTemplateId && selectedGenerationSourceTemplateIds.length === 0 && !templateNameInput.trim()}
            >
              New
            </button>
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
            {generateStatus && (
              <span className="text-xs" style={{ color: generateStatus.ok ? 'var(--success)' : 'var(--error)' }}>
                {generateStatus.msg}
              </span>
            )}
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
          <TemplateDirectoryTree
            title="Generation Templates"
            vendors={vendors}
            categories={generationCategories}
            templates={generationTemplates}
            loading={isLoadingGenerationTemplates || isLoadingTemplateDirectories}
            emptyText="No saved generation templates"
            activeTemplateId={selectedGenerationTemplateId}
            manageDirectories
            onTemplateClick={(templateId) => { void handleLoad(templateId) }}
            onMoveTemplate={(templateId, vendor, categoryPath) => useStore.getState().moveGenerationTemplate(templateId, vendor, categoryPath)}
            onDeleteTemplate={(templateId) => { void handleDelete(templateId) }}
            onCreateVendor={(name) => useStore.getState().createVendor(name)}
            onRenameVendor={(currentName, nextName) => useStore.getState().renameVendor(currentName, nextName)}
            onDeleteVendor={(name) => useStore.getState().deleteVendor(name)}
            onCreateCategory={(vendor, name, parentId) => useStore.getState().createCategory('generation', vendor, name, parentId)}
            onRenameCategory={(categoryId, vendor, name, parentId) => useStore.getState().updateCategory('generation', categoryId, vendor, name, parentId)}
            onDeleteCategory={(categoryId) => useStore.getState().deleteCategory('generation', categoryId)}
          />
        </div>

        <div
          className="border-r grid min-h-0 row-span-2"
          style={{
            borderColor: 'var(--border-color)',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)'
          }}
        >
          <div className="flex flex-col min-h-0">
            <div className="h-11 px-4 border-b flex items-center gap-2" style={{ borderColor: 'var(--border-color)' }}>
              <span className="text-sm whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>Right-click selection to</span>
              <span className="text-sm font-medium whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>Bind to Parse Parameter</span>
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
            <div className="h-11 px-4 border-b flex items-center justify-between gap-3" style={{ borderColor: 'var(--border-color)' }}>
              <h3 className="text-sm font-medium whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>Rendered Template Preview</h3>
              <button
                className="btn text-xs"
                onClick={() => setShowBindingsPanel(true)}
              >
                Bindings {generationBindings.length}
              </button>
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

        {showBindingsPanel && (
          <div
            className="absolute inset-0 z-30 flex items-center justify-center p-6"
            style={{ backgroundColor: 'var(--overlay-backdrop)' }}
          >
            <div
              className="w-full max-w-xl max-h-[85vh] overflow-auto rounded-xl border shadow-xl p-4"
              style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}
            >
              <div className="flex items-start justify-between mb-3 pt-1">
                <div>
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Review and remove the current parse bindings.</p>
                </div>
                <div className="flex gap-2 mt-0.5">
                  <button className="btn" onClick={() => setGenerationBindings([])} disabled={generationBindings.length === 0}>Clear</button>
                  <button className="btn" onClick={() => setShowBindingsPanel(false)}>Close</button>
                </div>
              </div>
              <div className="space-y-2">
                {generationBindings.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)' }}>No bindings yet.</p>
                ) : generationBindings.map((binding) => (
                  <div key={binding.id} className="group p-2 rounded border" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="min-w-0 flex-1 text-sm truncate" title={binding.originalText}>
                        {binding.originalText}
                      </div>
                      <div
                        className="h-4 border-l border-dashed flex-shrink-0"
                        style={{ borderColor: 'var(--border-color)' }}
                      />
                      <div
                        className="min-w-0 flex-1 text-sm truncate"
                        style={{ color: 'var(--accent-primary)' }}
                        title={binding.reference.expression}
                      >
                        {binding.reference.expression}
                      </div>
                      <button
                        className="flex-shrink-0 opacity-40 transition-opacity hover:opacity-100 group-hover:opacity-100"
                        style={{ color: 'var(--text-muted)' }}
                        onClick={() => removeBinding(binding.id)}
                        title="Remove binding"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {showTemplateSelector && (
          <div
            className="absolute inset-0 z-30 flex items-center justify-center p-6"
            style={{ backgroundColor: 'var(--overlay-backdrop)' }}
          >
            <div
              className="w-full max-w-3xl max-h-[85vh] overflow-auto rounded-xl border shadow-xl p-4"
              style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Template Selection</h3>
                  <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Choose one or more templates for parse bindings.</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleSelectAllSourceTemplates} className="btn">Toggle All</button>
                  <button onClick={() => setShowTemplateSelector(false)} className="btn">Close</button>
                </div>
              </div>

              <TemplateDirectoryTree
                title="Parse Templates"
                vendors={vendors}
                categories={parseCategories}
                templates={savedTemplates}
                loading={isLoadingTemplateDirectories}
                emptyText="No parse templates"
                selectedTemplateIds={selectedGenerationSourceTemplateIds}
                multiSelect
                onTemplateToggle={toggleSourceTemplate}
              />
            </div>
          </div>
        )}

        <div className="row-span-2 flex flex-col min-h-0" style={{ backgroundColor: 'var(--bg-secondary)' }}>
          <div className="flex-1 min-h-0 p-3 flex flex-col" style={{ borderColor: 'var(--border-color)' }}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Files</h3>
              <div className="flex items-center gap-2">
                <button
                  className="btn text-xs"
                  onClick={handleDownloadSampleJson}
                  disabled={!canDownloadSampleJson}
                >
                  Sample
                </button>
                <button
                  className="btn text-xs"
                  onClick={clearGenerationUploadedFiles}
                  disabled={generationUploadedFiles.length === 0}
                >
                  Clear
                </button>
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  {generationUploadedFiles.length}
                </span>
              </div>
            </div>
            <div
              {...getRootProps()}
              className="px-3 py-2 mx-2 mt-2 border border-dashed rounded-lg cursor-pointer transition-colors"
              style={{
                borderColor: isDragActive ? '#3b82f6' : 'var(--border-color)',
                backgroundColor: isDragActive ? 'rgba(59, 130, 246, 0.06)' : 'transparent'
              }}
            >
              <input {...getInputProps()} />
              <p className="text-sm text-center" style={{ color: 'var(--text-secondary)' }}>
                {isDragActive ? 'Drop JSON files here' : 'Drop JSON files or click'}
              </p>
            </div>
            <div className="mt-2 flex-1 min-h-0 space-y-1 overflow-auto">
              {generationUploadedFiles.map((file) => {
                const isSelected = file.id === selectedGenerationFileId
                return (
                  <div
                    key={file.id}
                    className="p-2 rounded cursor-pointer flex items-center justify-between gap-2 transition-colors"
                    style={{
                      background: isSelected
                        ? 'linear-gradient(90deg, var(--surface-selected-bg) 0%, var(--surface-selected-bg) 58%, transparent 100%)'
                        : 'linear-gradient(90deg, var(--bg-tertiary) 0%, transparent 100%)',
                      boxShadow: isSelected
                        ? 'inset 2px 0 0 var(--surface-selected-border)'
                        : 'inset 1px 0 0 var(--border-color)'
                    }}
                    onClick={() => setSelectedGenerationFileId(file.id)}
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <span style={{ color: 'var(--text-muted)' }}>
                        <UploadedJsonIcon />
                      </span>
                      <div className="min-w-0 truncate">{file.name}</div>
                    </div>
                    <button
                      className="flex-shrink-0 opacity-40 transition-opacity hover:opacity-100"
                      style={{ color: 'var(--text-muted)' }}
                      onClick={(event) => {
                        event.stopPropagation()
                        removeGenerationUploadedFile(file.id)
                      }}
                      title="Remove file"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
        </div>
      </div>
    </>
  )
}
