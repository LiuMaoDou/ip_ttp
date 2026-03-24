import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { useStore, buildGenerationSourceTemplates, type FileParseResult, type UploadedFile } from '../../store/useStore'
import { parseText } from '../../services/api'
import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import TemplateDirectoryTree from '../TemplateDirectoryTree'
import { formatFileSize, sanitizeFileNameSegment } from '../../utils'
import { buildMergedExcelBlob } from './mergedExcel'

interface TemplateSource {
  id: string
  name: string
  template: string
  vendor: string
  categoryPath: string[]
  description?: string
  source: 'current' | 'saved'
}

interface MergedResultGroup {
  fileId: string
  fileName: string
  results: FileParseResult[]
  payload: unknown
  successfulCount: number
  failedCount: number
}

interface IndividualResultGroup {
  fileId: string
  fileName: string
  items: Array<{ result: FileParseResult; index: number }>
  successfulCount: number
  failedCount: number
}

interface UploadedFileGroup {
  groupId: string
  groupName: string
  files: UploadedFile[]
}

type ResultViewMode = 'individual' | 'merged'

const TEST_RESULTS_SELECTED_TEMPLATE_IDS_STORAGE_KEY = 'ttp-test-results-selected-template-ids'
const SUPPORTED_TEST_FILE_EXTENSIONS = new Set([
  '.txt', '.log', '.cfg', '.conf', '.json', '.xml', '.yaml', '.yml'
])

function ResultChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d={expanded ? 'M6 15l6-6 6 6' : 'M9 6l6 6-6 6'}
      />
    </svg>
  )
}

function ResultFolderIcon() {
  return (
    <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 7.5A1.5 1.5 0 014.5 6h4.379a1.5 1.5 0 011.06.44l1.122 1.12a1.5 1.5 0 001.06.44H19.5A1.5 1.5 0 0121 9.5v8A2.5 2.5 0 0118.5 20h-13A2.5 2.5 0 013 17.5v-10z" />
    </svg>
  )
}

function getPathExtension(path: string): string {
  const normalizedPath = path.replace(/\\/g, '/')
  const fileName = normalizedPath.split('/').pop() || normalizedPath
  const extensionIndex = fileName.lastIndexOf('.')
  return extensionIndex >= 0 ? fileName.slice(extensionIndex).toLowerCase() : ''
}

function isSupportedTestFilePath(path: string): boolean {
  return SUPPORTED_TEST_FILE_EXTENSIONS.has(getPathExtension(path))
}

function decodeTextBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('latin1').decode(bytes)
  }
}

function getZipUploadGroupName(fileName: string): string {
  return fileName.replace(/\.zip$/i, '') || fileName
}

function getResultDownloadBaseName(result: FileParseResult): string {
  const baseName = result.fileName.replace(/\.[^/.]+$/, '') || 'result'
  const templateSuffix = result.templateName ? `.${sanitizeFileNameSegment(result.templateName)}` : ''
  return `${baseName}${templateSuffix}`
}

function getResultJsonDownloadName(result: FileParseResult): string {
  return `${getResultDownloadBaseName(result)}.json`
}

function getResultCsvDownloadName(result: FileParseResult): string {
  return `${getResultDownloadBaseName(result)}.csv`
}

function getResultCheckupDownloadName(result: FileParseResult): string {
  return `${getResultDownloadBaseName(result)}.checkup.csv`
}

function getMergedResultJsonDownloadName(fileName: string): string {
  const baseName = fileName.replace(/\.[^/.]+$/, '') || 'result'
  return `${baseName}.merged.json`
}

function getMergedExcelDownloadName(): string {
  return 'parse_results_merged.xlsx'
}

function getConfigGenerationDownloadName(fileName: string): string {
  const baseName = fileName.replace(/\.[^/.]+$/, '') || 'result'
  return `${baseName}.config-generation.json`
}

function hasSavedTemplateResult(result: Pick<FileParseResult, 'templateId'>): boolean {
  return Boolean(result.templateId && result.templateId !== 'current-template')
}

function buildConfigGenerationPayload(results: FileParseResult[], aliasMap: Map<string, string>): Record<string, unknown> | null {
  const templates: Record<string, unknown> = {}

  results.forEach((result) => {
    if (!hasDownloadableResult(result) || !hasSavedTemplateResult(result) || !result.templateId) {
      return
    }

    const alias = aliasMap.get(result.templateId)
    if (!alias) {
      return
    }

    templates[alias] = result.result
  })

  if (Object.keys(templates).length === 0) {
    return null
  }

  return { templates }
}

function hasDownloadableResult(result: Pick<FileParseResult, 'success' | 'result'>): boolean {
  return result.success && result.result !== undefined && result.result !== null
}

function hasDownloadableCsvResult(result: Pick<FileParseResult, 'success' | 'csvResult'>): boolean {
  return result.success && typeof result.csvResult === 'string'
}

function hasDownloadableCheckupResult(result: Pick<FileParseResult, 'success' | 'checkupCsvResult'>): boolean {
  return result.success && typeof result.checkupCsvResult === 'string'
}

function getCsvContent(result: Pick<FileParseResult, 'csvResult'>): string {
  return result.csvResult || ''
}

function getCheckupCsvContent(result: Pick<FileParseResult, 'checkupCsvResult'>): string {
  return result.checkupCsvResult || ''
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cloneMergedValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => cloneMergedValue(item))
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneMergedValue(item)])
    )
  }

  return value
}

function mergeMergedValues(currentValue: unknown, nextValue: unknown): unknown {
  if (currentValue === undefined) {
    return cloneMergedValue(nextValue)
  }

  if (Array.isArray(currentValue) && Array.isArray(nextValue)) {
    return [...currentValue, ...nextValue.map((item) => cloneMergedValue(item))]
  }

  if (isPlainObject(currentValue) && isPlainObject(nextValue)) {
    const mergedValue: Record<string, unknown> = { ...currentValue }

    Object.entries(nextValue).forEach(([key, value]) => {
      mergedValue[key] = key in mergedValue
        ? mergeMergedValues(mergedValue[key], value)
        : cloneMergedValue(value)
    })

    return mergedValue
  }

  if (Object.is(currentValue, nextValue)) {
    return currentValue
  }

  return [currentValue, cloneMergedValue(nextValue)]
}

function buildMergedResultPayload(results: FileParseResult[]): unknown {
  let mergedPayload: unknown = undefined
  const errors: Array<{ error: string; errorType?: string }> = []

  results.forEach((result) => {
    if (hasDownloadableResult(result)) {
      mergedPayload = mergeMergedValues(mergedPayload, result.result)
      return
    }

    errors.push({
      error: result.error || 'Unknown error',
      ...(result.errorType ? { errorType: result.errorType } : {})
    })
  })

  if (errors.length === 0) {
    return mergedPayload ?? {}
  }

  if (isPlainObject(mergedPayload)) {
    return {
      ...mergedPayload,
      errors
    }
  }

  return {
    result: mergedPayload ?? null,
    errors
  }
}

function buildMergedResultsDownloadPayload(groups: MergedResultGroup[]): unknown {
  if (groups.length === 1) {
    return groups[0].payload
  }

  return groups.map((group) => group.payload)
}

function getMergedResultState(group: Pick<MergedResultGroup, 'successfulCount' | 'failedCount'>): 'success' | 'mixed' | 'error' {
  if (group.successfulCount > 0 && group.failedCount === 0) {
    return 'success'
  }

  if (group.successfulCount > 0) {
    return 'mixed'
  }

  return 'error'
}

function loadStoredSelectedTemplateIds(): string[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const rawValue = window.localStorage.getItem(TEST_RESULTS_SELECTED_TEMPLATE_IDS_STORAGE_KEY)
    if (!rawValue) {
      return []
    }

    const parsedValue = JSON.parse(rawValue)
    return Array.isArray(parsedValue) ? parsedValue.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

export default function TestResults() {
  const {
    generatedTemplate,
    savedTemplates,
    isLoadingTemplates,
    isLoadingTemplateDirectories,
    vendors,
    parseCategories,
    templateName,
    files,
    addFile,
    removeFile,
    selectedFileId,
    selectFile,
    inputText,
    setInputText,
    isParsing,
    setIsParsing,
    theme,
    fileResults,
    setFileResults,
    selectedResultIndex,
    setSelectedResultIndex,
    selectedTestFileIds,
    setSelectedTestFileIds,
    clearFileResults
  } = useStore()

  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>(() => loadStoredSelectedTemplateIds())
  const [showDownloadMenu, setShowDownloadMenu] = useState(false)
  const [showResultDownloadMenu, setShowResultDownloadMenu] = useState(false)
  const [showTemplateSelector, setShowTemplateSelector] = useState(false)
  const [resultViewMode, setResultViewMode] = useState<ResultViewMode>('individual')
  const [selectedMergedResultIndex, setSelectedMergedResultIndex] = useState(0)
  const [collapsedResultFileGroups, setCollapsedResultFileGroups] = useState<Record<string, boolean>>({})
  const [collapsedUploadedFileGroups, setCollapsedUploadedFileGroups] = useState<Record<string, boolean>>({})
  const bulkDownloadMenuRef = useRef<HTMLDivElement | null>(null)
  const resultDownloadMenuRef = useRef<HTMLDivElement | null>(null)

  const savedTemplateOptions = useMemo<TemplateSource[]>(() => (
    savedTemplates
      .filter((tpl) => tpl.generatedTemplate.trim())
      .map((tpl) => ({
        id: tpl.id,
        name: tpl.name,
        template: tpl.generatedTemplate,
        vendor: tpl.vendor,
        categoryPath: tpl.categoryPath,
        description: tpl.description,
        source: 'saved' as const
      }))
  ), [savedTemplates])

  const currentTemplateOption = useMemo<TemplateSource | null>(() => {
    if (!generatedTemplate.trim()) {
      return null
    }
    const currentMatchesSaved = savedTemplateOptions.some((option) => option.template === generatedTemplate)
    if (currentMatchesSaved) {
      return null
    }
    return {
      id: 'current-template',
      name: templateName || 'Current Template',
      template: generatedTemplate,
      vendor: 'Unassigned',
      categoryPath: [],
      source: 'current'
    }
  }, [generatedTemplate, savedTemplateOptions, templateName])

  useEffect(() => {
    const optionIds = [
      ...(currentTemplateOption ? [currentTemplateOption.id] : []),
      ...savedTemplateOptions.map((option) => option.id)
    ]

    setSelectedTemplateIds((prev) => {
      const kept = prev.filter((id) => optionIds.includes(id))
      if (kept.length > 0) {
        return kept
      }

      const preferredId = currentTemplateOption?.id || savedTemplateOptions.find((option) => option.name === templateName)?.id
      return preferredId ? [preferredId] : optionIds.slice(0, 1)
    })
  }, [currentTemplateOption, savedTemplateOptions, templateName])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(
      TEST_RESULTS_SELECTED_TEMPLATE_IDS_STORAGE_KEY,
      JSON.stringify(selectedTemplateIds)
    )
  }, [selectedTemplateIds])

  useEffect(() => {
    const fileIds = files.map((file) => file.id)

    if (files.length === 0) {
      if (selectedFileId) {
        selectFile(null)
      }
      if (selectedTestFileIds !== null) {
        setSelectedTestFileIds(null)
      }
      return
    }

    const kept = selectedTestFileIds === null
      ? null
      : selectedTestFileIds.filter((id) => fileIds.includes(id))
    const nextSelectedFileIds = kept === null ? fileIds : kept

    const sameSelection =
      selectedTestFileIds !== null &&
      selectedTestFileIds.length === nextSelectedFileIds.length &&
      selectedTestFileIds.every((id, index) => id === nextSelectedFileIds[index])

    if (!sameSelection) {
      setSelectedTestFileIds(nextSelectedFileIds)
    }

    if (!selectedFileId || !files.some((file) => file.id === selectedFileId)) {
      selectFile(files[0].id)
    }
  }, [files, selectedFileId, selectedTestFileIds, selectFile, setSelectedTestFileIds])

  useEffect(() => {
    const handleDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target as Node

      if (showDownloadMenu && bulkDownloadMenuRef.current && !bulkDownloadMenuRef.current.contains(target)) {
        setShowDownloadMenu(false)
      }

      if (showResultDownloadMenu && resultDownloadMenuRef.current && !resultDownloadMenuRef.current.contains(target)) {
        setShowResultDownloadMenu(false)
      }
    }

    document.addEventListener('mousedown', handleDocumentMouseDown)
    return () => {
      document.removeEventListener('mousedown', handleDocumentMouseDown)
    }
  }, [showDownloadMenu, showResultDownloadMenu])

  const selectedTemplates = useMemo(
    () => {
      const options = currentTemplateOption ? [currentTemplateOption, ...savedTemplateOptions] : savedTemplateOptions
      return options.filter((option) => selectedTemplateIds.includes(option.id))
    },
    [currentTemplateOption, savedTemplateOptions, selectedTemplateIds]
  )

  const selectedFiles = useMemo(
    () => files.filter((file) => (selectedTestFileIds || []).includes(file.id)),
    [files, selectedTestFileIds]
  )

  const uploadedFileGroups = useMemo<UploadedFileGroup[]>(
    () => {
      const grouped = new Map<string, UploadedFileGroup>()
      files.forEach((file) => {
        if (!file.uploadGroupId || !file.uploadGroupName) {
          return
        }

        const existing = grouped.get(file.uploadGroupId)
        if (existing) {
          existing.files.push(file)
          return
        }

        grouped.set(file.uploadGroupId, {
          groupId: file.uploadGroupId,
          groupName: file.uploadGroupName,
          files: [file]
        })
      })

      return Array.from(grouped.values()).map((group) => ({
        ...group,
        files: [...group.files].sort((left, right) => left.name.localeCompare(right.name))
      }))
    },
    [files]
  )

  const directUploadedFiles = useMemo(
    () => files.filter((file) => !file.uploadGroupId),
    [files]
  )

  const previewFile = files.find((file) => file.id === selectedFileId) ?? null

  const configGenerationAliasMap = useMemo(() => {
    const savedTemplateIds = Array.from(new Set(
      fileResults
        .filter((result) => hasSavedTemplateResult(result))
        .map((result) => result.templateId as string)
    ))

    const sourceTemplates = buildGenerationSourceTemplates(savedTemplates, savedTemplateIds)
    return new Map(sourceTemplates.map((template) => [template.templateId, template.templateAlias]))
  }, [fileResults, savedTemplates])

  const groupedConfigGenerationPayloads = useMemo(() => {
    const grouped = new Map<string, { fileName: string; results: FileParseResult[] }>()

    fileResults.forEach((result) => {
      if (!hasDownloadableResult(result) || !hasSavedTemplateResult(result)) {
        return
      }

      const existing = grouped.get(result.fileId)
      if (existing) {
        existing.results.push(result)
        return
      }

      grouped.set(result.fileId, {
        fileName: result.fileName,
        results: [result]
      })
    })

    return Array.from(grouped.values())
      .map((group) => ({
        fileName: group.fileName,
        payload: buildConfigGenerationPayload(group.results, configGenerationAliasMap)
      }))
      .filter((group): group is { fileName: string; payload: Record<string, unknown> } => Boolean(group.payload))
  }, [configGenerationAliasMap, fileResults])

  const mergedResults = useMemo<MergedResultGroup[]>(() => {
    const grouped = new Map<string, { fileName: string; results: FileParseResult[] }>()

    fileResults.forEach((result) => {
      const existing = grouped.get(result.fileId)
      if (existing) {
        existing.results.push(result)
        return
      }

      grouped.set(result.fileId, {
        fileName: result.fileName,
        results: [result]
      })
    })

    return Array.from(grouped.entries()).map(([fileId, group]) => {
      const successfulCount = group.results.filter((result) => result.success).length
      const failedCount = group.results.length - successfulCount

      return {
        fileId,
        fileName: group.fileName,
        results: group.results,
        payload: buildMergedResultPayload(group.results),
        successfulCount,
        failedCount
      }
    })
  }, [fileResults])

  const individualResultGroups = useMemo<IndividualResultGroup[]>(() => {
    const grouped = new Map<string, IndividualResultGroup>()

    fileResults.forEach((result, index) => {
      const existing = grouped.get(result.fileId)
      if (existing) {
        existing.items.push({ result, index })
        if (result.success) {
          existing.successfulCount += 1
        } else {
          existing.failedCount += 1
        }
        return
      }

      grouped.set(result.fileId, {
        fileId: result.fileId,
        fileName: result.fileName,
        items: [{ result, index }],
        successfulCount: result.success ? 1 : 0,
        failedCount: result.success ? 0 : 1
      })
    })

    return Array.from(grouped.values())
  }, [fileResults])

  const canShowMergedView = mergedResults.some((group) => group.results.length > 1)
  const canDownloadConfigGeneration = groupedConfigGenerationPayloads.length > 0

  useEffect(() => {
    if (!canShowMergedView && resultViewMode === 'merged') {
      setResultViewMode('individual')
    }
  }, [canShowMergedView, resultViewMode])

  useEffect(() => {
    if (mergedResults.length === 0) {
      setSelectedMergedResultIndex(0)
      return
    }

    setSelectedMergedResultIndex((current) => Math.min(current, mergedResults.length - 1))
  }, [mergedResults])

  useEffect(() => {
    const validFileIds = new Set(individualResultGroups.map((group) => group.fileId))
    setCollapsedResultFileGroups((current) => (
      Object.fromEntries(
        Object.entries(current).filter(([fileId]) => validFileIds.has(fileId))
      )
    ))
  }, [individualResultGroups])

  useEffect(() => {
    const validGroupIds = new Set(uploadedFileGroups.map((group) => group.groupId))
    setCollapsedUploadedFileGroups((current) => (
      Object.fromEntries(
        Object.entries(current).filter(([groupId]) => validGroupIds.has(groupId))
      )
    ))
  }, [uploadedFileGroups])

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    clearFileResults()

    const readPlainFile = (file: File) => new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error || new Error(`Failed to read ${file.name}`))
      reader.readAsText(file)
    })

    const uploadedFiles: UploadedFile[] = []

    for (const file of acceptedFiles) {
      if (getPathExtension(file.name) === '.zip') {
        const uploadGroupId = `zip-${Date.now()}-${uploadedFiles.length}-${Math.random().toString(36).substr(2, 9)}`
        const uploadGroupName = getZipUploadGroupName(file.name)
        const zip = await JSZip.loadAsync(file)
        const entries = Object.values(zip.files)
          .filter((entry) => !entry.dir && isSupportedTestFilePath(entry.name))
          .sort((left, right) => left.name.localeCompare(right.name))

        for (const entry of entries) {
          const bytes = await entry.async('uint8array')
          const content = decodeTextBytes(bytes)
          uploadedFiles.push({
            id: `file-${Date.now()}-${uploadedFiles.length}-${Math.random().toString(36).substr(2, 9)}`,
            name: entry.name,
            size: bytes.length,
            content,
            uploadGroupId,
            uploadGroupName
          })
        }

        continue
      }

      const content = await readPlainFile(file)
      uploadedFiles.push({
        id: `file-${Date.now()}-${uploadedFiles.length}-${Math.random().toString(36).substr(2, 9)}`,
        name: file.name,
        size: file.size,
        content
      })
    }

    uploadedFiles.forEach((uploadedFile) => addFile(uploadedFile))
    setSelectedTestFileIds(uploadedFiles.map((uploadedFile) => uploadedFile.id))
    selectFile(uploadedFiles[0]?.id || null)
  }, [addFile, clearFileResults, selectFile, setSelectedTestFileIds])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/*': ['.txt', '.log', '.cfg', '.conf', '.json', '.xml', '.yaml', '.yml'],
      'application/*': ['.cfg', '.conf', '.zip'],
      'application/zip': ['.zip']
    },
    multiple: true
  })

  const toggleTemplateSelection = (id: string) => {
    setSelectedTemplateIds((prev) => (
      prev.includes(id)
        ? prev.filter((templateId) => templateId !== id)
        : [...prev, id]
    ))
  }

  const handleSelectAllTemplates = () => {
    const allTemplateIds = [
      ...(currentTemplateOption ? [currentTemplateOption.id] : []),
      ...savedTemplateOptions.map((template) => template.id)
    ]

    if (allTemplateIds.length === 0) {
      return
    }

    const isAllSelected =
      selectedTemplateIds.length === allTemplateIds.length &&
      allTemplateIds.every((templateId) => selectedTemplateIds.includes(templateId))

    setSelectedTemplateIds(isAllSelected ? [] : allTemplateIds)
  }

  const toggleFileSelection = (id: string) => {
    setSelectedTestFileIds((prev) => {
      const current = prev || []
      return current.includes(id)
        ? current.filter((fileId) => fileId !== id)
        : [...current, id]
    })
  }

  const handleSelectAllFiles = () => {
    if (files.length === 0) {
      return
    }

    const allFileIds = files.map((file) => file.id)
    const isAllSelected = (selectedTestFileIds || []).length === files.length

    setSelectedTestFileIds(isAllSelected ? [] : allFileIds)

    if (!isAllSelected && (!selectedFileId || !files.some((file) => file.id === selectedFileId))) {
      selectFile(files[0].id)
    }
  }

  const handleRemoveSelectedFiles = () => {
    const selectedIds = selectedTestFileIds || []
    if (selectedIds.length === 0) {
      return
    }

    selectedIds.forEach((fileId) => removeFile(fileId))
    setSelectedTestFileIds([])
    clearFileResults()
    setSelectedResultIndex(0)
    setSelectedMergedResultIndex(0)

    const remainingFiles = files.filter((file) => !selectedIds.includes(file.id))
    selectFile(remainingFiles[0]?.id || null)
  }

  const toggleUploadedFileGroup = (groupId: string) => {
    setCollapsedUploadedFileGroups((current) => ({
      ...current,
      [groupId]: !current[groupId]
    }))
  }

  const toggleResultFileGroup = (fileId: string) => {
    setCollapsedResultFileGroups((current) => ({
      ...current,
      [fileId]: !current[fileId]
    }))
  }

  const handleRemoveFile = (id: string) => {
    removeFile(id)
    setSelectedTestFileIds((prev) => prev?.filter((fileId) => fileId !== id) ?? null)
    clearFileResults()
    setSelectedResultIndex(0)
    setSelectedMergedResultIndex(0)
  }

  const handleTest = async () => {
    if (selectedTemplates.length === 0) {
      setFileResults([{
        fileId: 'error',
        fileName: 'Error',
        result: null,
        success: false,
        error: 'No template selected. Please select at least one template.'
      }])
      return
    }

    const inputSources: { id: string; name: string; content: string }[] = []

    if (selectedFiles.length > 0) {
      selectedFiles.forEach((file) => {
        inputSources.push({ id: file.id, name: file.name, content: file.content })
      })
    }

    if (inputSources.length === 0 && inputText.trim() && files.length === 0) {
      inputSources.push({ id: 'manual', name: 'Manual Input', content: inputText })
    }

    if (inputSources.length === 0) {
      setFileResults([{
        fileId: 'error',
        fileName: 'Error',
        result: null,
        success: false,
        error: files.length > 0
          ? 'No files selected. Please select at least one file.'
          : 'No input data. Please upload files or enter text.'
      }])
      return
    }

    setIsParsing(true)
    setFileResults([])
    setSelectedResultIndex(0)
    setSelectedMergedResultIndex(0)

    try {
      const results: FileParseResult[] = []

      for (const templateSource of selectedTemplates) {
        for (const source of inputSources) {
          try {
            const result = await parseText(source.content, templateSource.template)
            results.push({
              fileId: source.id,
              fileName: source.name,
              templateId: templateSource.id,
              templateName: templateSource.name,
              result: result.result,
              csvResult: result.csvResult,
              checkupCsvResult: result.checkupCsvResult,
              success: result.success,
              error: result.error,
              errorType: result.errorType
            })
          } catch (error) {
            results.push({
              fileId: source.id,
              fileName: source.name,
              templateId: templateSource.id,
              templateName: templateSource.name,
              result: null,
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
              errorType: 'NetworkError'
            })
          }
        }
      }

      setFileResults(results)
    } catch (error) {
      setFileResults([{
        fileId: 'error',
        fileName: 'Error',
        result: null,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        errorType: 'NetworkError'
      }])
    } finally {
      setIsParsing(false)
    }
  }

  const handleClearAll = () => {
    files.forEach((file) => removeFile(file.id))
    setSelectedTestFileIds(null)
    setInputText('')
    clearFileResults()
    setSelectedResultIndex(0)
    setSelectedMergedResultIndex(0)
    selectFile(null)
  }

  const handleDownloadSingleJson = (result: FileParseResult) => {
    if (!hasDownloadableResult(result)) return
    const jsonStr = JSON.stringify(result.result, null, 2)
    const blob = new Blob([jsonStr], { type: 'application/json' })
    saveAs(blob, getResultJsonDownloadName(result))
  }

  const handleDownloadSingleCsv = (result: FileParseResult) => {
    if (!hasDownloadableCsvResult(result)) return
    const csvStr = getCsvContent(result)
    const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8' })
    saveAs(blob, getResultCsvDownloadName(result))
  }

  const handleDownloadSingleCheckup = (result: FileParseResult) => {
    if (!hasDownloadableCheckupResult(result)) return
    const csvStr = getCheckupCsvContent(result)
    const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8' })
    saveAs(blob, getResultCheckupDownloadName(result))
  }

  const handleDownloadAllJson = async () => {
    const downloadableResults = fileResults.filter(hasDownloadableResult)
    if (downloadableResults.length === 0) return

    const zip = new JSZip()
    downloadableResults.forEach((result) => {
      const jsonStr = JSON.stringify(result.result, null, 2)
      zip.file(getResultJsonDownloadName(result), jsonStr)
    })

    const content = await zip.generateAsync({ type: 'blob' })
    saveAs(content, 'parse_results_json.zip')
  }

  const handleDownloadAllCsv = async () => {
    const downloadableResults = fileResults.filter(hasDownloadableCsvResult)
    if (downloadableResults.length === 0) return

    const zip = new JSZip()
    downloadableResults.forEach((result) => {
      zip.file(getResultCsvDownloadName(result), getCsvContent(result))
    })

    const content = await zip.generateAsync({ type: 'blob' })
    saveAs(content, 'parse_results_csv.zip')
  }

  const handleDownloadAllCheckup = async () => {
    const downloadableResults = fileResults.filter(hasDownloadableCheckupResult)
    if (downloadableResults.length === 0) return

    const zip = new JSZip()
    downloadableResults.forEach((result) => {
      zip.file(getResultCheckupDownloadName(result), getCheckupCsvContent(result))
    })

    const content = await zip.generateAsync({ type: 'blob' })
    saveAs(content, 'parse_results_checkup.zip')
  }

  const handleDownloadSingleMergedJson = (group: MergedResultGroup) => {
    const blob = new Blob([JSON.stringify(group.payload, null, 2)], { type: 'application/json' })
    saveAs(blob, getMergedResultJsonDownloadName(group.fileName))
  }

  const handleDownloadAllMergedJson = async () => {
    if (mergedResults.length === 0) return

    if (mergedResults.length === 1) {
      handleDownloadSingleMergedJson(mergedResults[0])
      return
    }

    const payload = buildMergedResultsDownloadPayload(mergedResults)
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    saveAs(blob, 'parse_results_merged.json')
  }

  const handleDownloadMergedExcel = () => {
    if (fileResults.length === 0) return

    const blob = buildMergedExcelBlob(fileResults)
    saveAs(blob, getMergedExcelDownloadName())
  }

  const handleDownloadSingleConfigGenerationJson = (result: FileParseResult) => {
    if (!hasDownloadableResult(result) || !hasSavedTemplateResult(result) || !result.templateId) return

    const alias = configGenerationAliasMap.get(result.templateId)
    if (!alias) return

    const payload = {
      templates: {
        [alias]: result.result
      }
    }

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    saveAs(blob, getConfigGenerationDownloadName(result.fileName))
  }

  const handleDownloadAllConfigGenerationJson = async () => {
    if (groupedConfigGenerationPayloads.length === 0) return

    if (groupedConfigGenerationPayloads.length === 1) {
      const [group] = groupedConfigGenerationPayloads
      const blob = new Blob([JSON.stringify(group.payload, null, 2)], { type: 'application/json' })
      saveAs(blob, getConfigGenerationDownloadName(group.fileName))
      return
    }

    const zip = new JSZip()
    groupedConfigGenerationPayloads.forEach((group) => {
      zip.file(getConfigGenerationDownloadName(group.fileName), JSON.stringify(group.payload, null, 2))
    })

    const content = await zip.generateAsync({ type: 'blob' })
    saveAs(content, 'parse_results_config_generation.zip')
  }

  const currentResult = fileResults[selectedResultIndex] || fileResults[0]
  const currentMergedResult = mergedResults[selectedMergedResultIndex] || mergedResults[0]
  const isMergedView = resultViewMode === 'merged' && canShowMergedView
  const currentMergedResultState = currentMergedResult ? getMergedResultState(currentMergedResult) : null
  const totalTemplateOptions = savedTemplateOptions.length + (currentTemplateOption ? 1 : 0)
  const successfulCount = fileResults.filter((result) => result.success).length
  const failedCount = fileResults.filter((result) => result.success === false).length
  const hasBulkJsonDownload = fileResults.some(hasDownloadableResult)
  const hasBulkCsvDownload = fileResults.some(hasDownloadableCsvResult)
  const hasBulkCheckupDownload = fileResults.some(hasDownloadableCheckupResult)
  const hasBulkMergedJsonDownload = canShowMergedView && mergedResults.length > 0
  const hasBulkMergedExcelDownload = fileResults.length > 0
  const hasBulkDownloads = hasBulkJsonDownload || hasBulkCsvDownload || hasBulkCheckupDownload || hasBulkMergedJsonDownload || hasBulkMergedExcelDownload || canDownloadConfigGeneration
  const hasResultJsonDownload = currentResult ? hasDownloadableResult(currentResult) : false
  const hasResultCsvDownload = currentResult ? hasDownloadableCsvResult(currentResult) : false
  const hasResultCheckupDownload = currentResult ? hasDownloadableCheckupResult(currentResult) : false
  const hasResultGenerationDownload = currentResult ? hasDownloadableResult(currentResult) && hasSavedTemplateResult(currentResult) : false
  const hasMergedResultJsonDownload = Boolean(currentMergedResult)
  const hasResultDownloads = isMergedView
    ? hasMergedResultJsonDownload
    : hasResultJsonDownload || hasResultCsvDownload || hasResultCheckupDownload || hasResultGenerationDownload
  const canRun = !isLoadingTemplates && selectedTemplates.length > 0 && (selectedFiles.length > 0 || (!files.length && !!inputText.trim()))

  return (
    <div className="flex flex-col h-full text-sm" style={{ backgroundColor: 'var(--bg-primary)', fontSize: '14px' }}>
      <div className="page-header">
        <div className="flex items-center gap-3 min-w-0">
          <h2 style={{ fontSize: '14px' }}>Test & Results</h2>
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
            {selectedTemplates.length}/{totalTemplateOptions} selected
          </span>
        </div>
        <div className="flex gap-2 items-center">
          <div className="hidden md:flex items-center gap-2 mr-4">
            <span className="text-sm px-2 py-1 rounded" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
              Files {(selectedTestFileIds || []).length}/{files.length}
            </span>
          </div>
          <button onClick={handleClearAll} className="btn" disabled={files.length === 0 && !inputText}>
            Clear
          </button>
          <button
            onClick={handleTest}
            disabled={isParsing || !canRun}
            className="btn"
          >
            {isParsing ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Parsing...
              </span>
            ) : (
              'Run Test'
            )}
          </button>
          {hasBulkDownloads && (
            <div className="relative" ref={bulkDownloadMenuRef}>
              <button
                onClick={() => setShowDownloadMenu((current) => !current)}
                className="btn flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showDownloadMenu && (
                <div
                  className="absolute right-0 mt-2 min-w-40 rounded-md border shadow-lg z-20 overflow-hidden"
                  style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}
                >
                  {hasBulkJsonDownload && (
                    <button
                      onClick={() => {
                        setShowDownloadMenu(false)
                        void handleDownloadAllJson()
                      }}
                      className="w-full text-left px-3 py-2 text-sm"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      JSON
                    </button>
                  )}
                  {hasBulkCsvDownload && (
                    <button
                      onClick={() => {
                        setShowDownloadMenu(false)
                        void handleDownloadAllCsv()
                      }}
                      className="w-full text-left px-3 py-2 text-sm"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      CSV
                    </button>
                  )}
                  {hasBulkCheckupDownload && (
                    <button
                      onClick={() => {
                        setShowDownloadMenu(false)
                        void handleDownloadAllCheckup()
                      }}
                      className="w-full text-left px-3 py-2 text-sm"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      Checkup
                    </button>
                  )}
                  {hasBulkMergedJsonDownload && (
                    <button
                      onClick={() => {
                        setShowDownloadMenu(false)
                        void handleDownloadAllMergedJson()
                      }}
                      className="w-full text-left px-3 py-2 text-sm"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      Merged JSON
                    </button>
                  )}
                  {hasBulkMergedExcelDownload && (
                    <button
                      onClick={() => {
                        setShowDownloadMenu(false)
                        handleDownloadMergedExcel()
                      }}
                      className="w-full text-left px-3 py-2 text-sm"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      Merged Excel
                    </button>
                  )}
                  {canDownloadConfigGeneration && (
                    <button
                      onClick={() => {
                        setShowDownloadMenu(false)
                        void handleDownloadAllConfigGenerationJson()
                      }}
                      className="w-full text-left px-3 py-2 text-sm"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      Generation
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div
        className="flex-1 grid min-h-0"
        style={{
          gridTemplateColumns: '14rem minmax(0, 1fr) minmax(0, 1fr) 14rem'
        }}
      >
        <div className="border-r flex flex-col min-h-0" style={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
          <div
            {...getRootProps()}
            className="p-2 m-2 border-2 border-dashed rounded-lg cursor-pointer transition-colors"
            style={{
              borderColor: isDragActive ? '#3b82f6' : 'var(--border-color)',
              backgroundColor: isDragActive ? 'rgba(59, 130, 246, 0.1)' : 'transparent'
            }}
          >
            <input {...getInputProps()} />
            <div className="text-center">
              <svg className="w-6 h-6 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--text-muted)' }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-sm leading-5" style={{ color: 'var(--text-secondary)' }}>
                {isDragActive ? 'Drop files or zip here' : 'Drop Files / Zip\nor click'}
              </p>
            </div>
          </div>

          <div className="flex-1 overflow-auto p-2">
            <div className="flex items-center justify-between mb-2 px-1">
              <h4 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Files</h4>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSelectAllFiles}
                  className="inline-flex items-center justify-center w-6 h-6 rounded transition-colors"
                  style={{ color: 'var(--accent-primary)' }}
                  disabled={files.length === 0}
                  title="Select all files"
                  aria-label="Select all files"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v2m10-4h2a2 2 0 012 2v2M9 19H7a2 2 0 01-2-2v-2m10 4h2a2 2 0 002-2v-2M8 12l2.5 2.5L16 9" />
                  </svg>
                </button>
                <button
                  onClick={handleRemoveSelectedFiles}
                  className="inline-flex items-center justify-center w-6 h-6 rounded transition-colors"
                  style={{ color: 'var(--error)' }}
                  disabled={(selectedTestFileIds || []).length === 0}
                  title="Delete selected files"
                  aria-label="Delete selected files"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3M4 7h16" />
                  </svg>
                </button>
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  {(selectedTestFileIds || []).length}/{files.length}
                </span>
              </div>
            </div>
            {files.length === 0 ? (
              <p className="text-sm px-1 py-4 text-center" style={{ color: 'var(--text-muted)' }}>
                No files
              </p>
            ) : (
              <div className="space-y-0.5">
                {directUploadedFiles.map((file) => {
                  const isSelected = (selectedTestFileIds || []).includes(file.id)
                  const isPreviewed = selectedFileId === file.id

                  return (
                    <div
                      key={file.id}
                      onClick={() => selectFile(file.id)}
                      className="px-2 py-1.5 rounded-md cursor-pointer group transition-colors"
                      style={{
                        backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.18)' : isPreviewed ? 'var(--bg-tertiary)' : 'transparent',
                        border: isPreviewed ? '1px solid rgba(59, 130, 246, 0.5)' : '1px solid transparent'
                      }}
                      title={file.name}
                    >
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleFileSelection(file.id)}
                          onClick={(event) => event.stopPropagation()}
                          className="mt-0.5 h-3.5 w-3.5 accent-blue-500"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{file.name}</p>
                          <p className="text-sm truncate" style={{ color: 'var(--text-muted)' }}>{formatFileSize(file.size)}</p>
                        </div>
                        <button
                          onClick={(event) => {
                            event.stopPropagation()
                            handleRemoveFile(file.id)
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{ color: 'var(--text-muted)' }}
                          title="Remove file"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  )
                })}
                {uploadedFileGroups.map((group) => {
                  const isCollapsed = collapsedUploadedFileGroups[group.groupId] ?? false
                  const selectedCount = group.files.filter((file) => (selectedTestFileIds || []).includes(file.id)).length
                  const hasPreviewedChild = group.files.some((file) => file.id === selectedFileId)

                  return (
                    <div key={group.groupId} className="space-y-0.5">
                      <div
                        onClick={() => toggleUploadedFileGroup(group.groupId)}
                        className="px-2 py-1.5 rounded-md cursor-pointer transition-colors"
                        style={{
                          backgroundColor: selectedCount > 0 ? 'rgba(59, 130, 246, 0.14)' : hasPreviewedChild ? 'var(--bg-tertiary)' : 'transparent',
                          border: hasPreviewedChild ? '1px solid rgba(59, 130, 246, 0.4)' : '1px solid transparent'
                        }}
                        title={group.groupName}
                      >
                        <div className="flex items-start gap-2">
                          <span className="mt-0.5" style={{ color: 'var(--text-muted)' }}>
                            <ResultChevronIcon expanded={!isCollapsed} />
                          </span>
                          <span className="mt-0.5" style={{ color: 'var(--text-muted)' }}>
                            <ResultFolderIcon />
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{group.groupName}</p>
                            <p className="text-sm truncate" style={{ color: 'var(--text-muted)' }}>{selectedCount}/{group.files.length}</p>
                          </div>
                        </div>
                      </div>
                      {!isCollapsed && (
                        <div className="space-y-0.5">
                          {group.files.map((file) => {
                            const isSelected = (selectedTestFileIds || []).includes(file.id)
                            const isPreviewed = selectedFileId === file.id

                            return (
                              <div
                                key={file.id}
                                onClick={() => selectFile(file.id)}
                                className="ml-3 px-2 py-1 rounded-md cursor-pointer group transition-colors"
                                style={{
                                  backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.18)' : isPreviewed ? 'var(--bg-tertiary)' : 'transparent',
                                  border: isPreviewed ? '1px solid rgba(59, 130, 246, 0.5)' : '1px solid transparent'
                                }}
                                title={file.name}
                              >
                                <div className="flex items-start gap-2">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleFileSelection(file.id)}
                                    onClick={(event) => event.stopPropagation()}
                                    className="mt-0.5 h-3.5 w-3.5 accent-blue-500"
                                  />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{file.name}</p>
                                    <p className="text-sm truncate" style={{ color: 'var(--text-muted)' }}>{formatFileSize(file.size)}</p>
                                  </div>
                                  <button
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      handleRemoveFile(file.id)
                                    }}
                                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                                    style={{ color: 'var(--text-muted)' }}
                                    title="Remove file"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <div className="border-r flex flex-col min-w-0 min-h-0" style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-color)' }}>
          <div className="h-11 px-4 border-b flex items-center" style={{ borderColor: 'var(--border-color)' }}>
            <div className="flex items-center gap-3 min-w-0 w-full">
              <h3 className="text-sm font-medium whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>Config Preview</h3>
              <span className="text-sm truncate" style={{ color: 'var(--text-secondary)' }}>
                {previewFile ? previewFile.name : 'Click a file to preview'}
              </span>
              {previewFile && (
                <span className="text-sm whitespace-nowrap ml-auto" style={{ color: 'var(--text-muted)' }}>
                  {formatFileSize(previewFile.size)}
                </span>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-auto p-4" style={{ backgroundColor: theme === 'dark' ? '#181825' : '#f8fafc' }}>
            {previewFile ? (
              <pre className="text-sm whitespace-pre-wrap font-mono" style={{ color: theme === 'dark' ? '#cdd6f4' : '#1e293b' }}>
                {previewFile.content}
              </pre>
            ) : (
              <div className="h-full flex items-center justify-center text-center px-6" style={{ color: 'var(--text-muted)' }}>
                <div>
                  <svg className="w-12 h-12 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6M9 8h6m-7 12h8a2 2 0 002-2V6.828a2 2 0 00-.586-1.414l-2.828-2.828A2 2 0 0013.172 2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  <p className="text-sm mb-1">No file preview</p>
                  <p className="text-sm">Select a file from the Files list to inspect its content.</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col min-w-0 min-h-0" style={{ backgroundColor: 'var(--bg-primary)' }}>
          <div className="h-11 px-4 border-b flex items-center gap-4 min-w-0" style={{ borderColor: 'var(--border-color)' }}>
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Results:</span>
            {fileResults.length > 0 ? (
              <>
                {successfulCount > 0 && (
                  <span className="text-sm flex items-center gap-1" style={{ color: '#22c55e' }}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {successfulCount} OK
                  </span>
                )}
                {failedCount > 0 && (
                  <span className="text-sm flex items-center gap-1" style={{ color: '#ef4444' }}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    {failedCount} Failed
                  </span>
                )}
                {canShowMergedView && (
                  <div className="ml-auto inline-flex rounded-md border overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                    <button
                      onClick={() => setResultViewMode('individual')}
                      className="px-3 py-1 text-sm transition-colors"
                      style={{
                        backgroundColor: !isMergedView ? 'rgba(59, 130, 246, 0.16)' : 'transparent',
                        color: !isMergedView ? 'var(--accent-primary)' : 'var(--text-secondary)'
                      }}
                    >
                      Individual
                    </button>
                    <button
                      onClick={() => setResultViewMode('merged')}
                      className="px-3 py-1 text-sm transition-colors"
                      style={{
                        backgroundColor: isMergedView ? 'rgba(59, 130, 246, 0.16)' : 'transparent',
                        color: isMergedView ? 'var(--accent-primary)' : 'var(--text-secondary)'
                      }}
                    >
                      Merged
                    </button>
                  </div>
                )}
              </>
            ) : (
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>No results yet</span>
            )}
          </div>

          <div className="flex-1 overflow-auto p-4 min-w-0">
          {!fileResults.length ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center" style={{ color: 'var(--text-muted)' }}>
                <svg className="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm mb-2">No results yet</p>
                <p className="text-sm mb-2">1. Select one or more templates</p>
                <p className="text-sm mb-2">2. Select one or more files</p>
                <p className="text-sm">3. Click "Run Test"</p>
                {selectedTemplates.length === 0 && (
                  <p className="text-sm mt-4" style={{ color: 'var(--error)' }}>No template selected</p>
                )}
              </div>
            </div>
          ) : isMergedView && currentMergedResult ? (
            <div>
              <div
                className="mb-4 p-3 rounded-lg flex items-center gap-2"
                style={{
                  backgroundColor:
                    currentMergedResultState === 'success'
                      ? theme === 'dark' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(34, 197, 94, 0.1)'
                      : currentMergedResultState === 'error'
                        ? theme === 'dark' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(239, 68, 68, 0.1)'
                        : theme === 'dark' ? 'rgba(245, 158, 11, 0.16)' : 'rgba(245, 158, 11, 0.12)',
                  border:
                    currentMergedResultState === 'success'
                      ? '1px solid rgba(34, 197, 94, 0.3)'
                      : currentMergedResultState === 'error'
                        ? '1px solid rgba(239, 68, 68, 0.3)'
                        : '1px solid rgba(245, 158, 11, 0.35)'
                }}
              >
                {currentMergedResultState === 'success' ? (
                  <svg className="w-5 h-5" style={{ color: '#22c55e' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : currentMergedResultState === 'error' ? (
                  <svg className="w-5 h-5" style={{ color: '#ef4444' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" style={{ color: '#f59e0b' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M4.93 19h14.14c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.2 16c-.77 1.33.19 3 1.73 3z" />
                  </svg>
                )}
                <span
                  className="font-medium"
                  style={{
                    color:
                      currentMergedResultState === 'success'
                        ? '#22c55e'
                        : currentMergedResultState === 'error'
                          ? '#ef4444'
                          : '#f59e0b'
                  }}
                >
                  Merged results
                </span>
                <span className="text-sm ml-auto mr-2 truncate" style={{ color: 'var(--text-muted)' }}>
                  {currentMergedResult.fileName}
                </span>
                {hasResultDownloads && (
                  <div className="relative" ref={resultDownloadMenuRef}>
                    <button
                      onClick={() => setShowResultDownloadMenu((current) => !current)}
                      className="btn text-sm flex items-center gap-1"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Download
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {showResultDownloadMenu && (
                      <div
                        className="absolute right-0 mt-2 min-w-40 rounded-md border shadow-lg z-20 overflow-hidden"
                        style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}
                      >
                        {hasMergedResultJsonDownload && (
                          <button
                            onClick={() => {
                              setShowResultDownloadMenu(false)
                              handleDownloadSingleMergedJson(currentMergedResult)
                            }}
                            className="w-full text-left px-3 py-2 text-sm"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            JSON
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="rounded-lg p-4 overflow-auto" style={{ backgroundColor: theme === 'dark' ? '#1e1e2e' : '#f8fafc', border: `1px solid ${theme === 'dark' ? '#313244' : '#e2e8f0'}` }}>
                <pre className="text-sm whitespace-pre-wrap font-mono" style={{ color: theme === 'dark' ? '#cdd6f4' : '#1e293b' }}>
                  {JSON.stringify(currentMergedResult.payload, null, 2)}
                </pre>
              </div>
            </div>
          ) : currentResult?.success ? (
            <div>
              <div className="mb-4 p-3 rounded-lg flex items-center gap-2" style={{ backgroundColor: theme === 'dark' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.3)' }}>
                <svg className="w-5 h-5" style={{ color: '#22c55e' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="font-medium" style={{ color: '#22c55e' }}>Parse successful</span>
                {currentResult && (
                  <span className="text-sm ml-auto mr-2 truncate" style={{ color: 'var(--text-muted)' }}>
                    {currentResult.templateName ? `${currentResult.templateName} · ${currentResult.fileName}` : currentResult.fileName}
                  </span>
                )}
                {hasResultDownloads && (
                  <div className="relative" ref={resultDownloadMenuRef}>
                    <button
                      onClick={() => setShowResultDownloadMenu((current) => !current)}
                      className="btn text-sm flex items-center gap-1"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Download
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {showResultDownloadMenu && currentResult && (
                      <div
                        className="absolute right-0 mt-2 min-w-40 rounded-md border shadow-lg z-20 overflow-hidden"
                        style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}
                      >
                        {hasResultJsonDownload && (
                          <button
                            onClick={() => {
                              setShowResultDownloadMenu(false)
                              handleDownloadSingleJson(currentResult)
                            }}
                            className="w-full text-left px-3 py-2 text-sm"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            JSON
                          </button>
                        )}
                        {hasResultCsvDownload && (
                          <button
                            onClick={() => {
                              setShowResultDownloadMenu(false)
                              handleDownloadSingleCsv(currentResult)
                            }}
                            className="w-full text-left px-3 py-2 text-sm"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            CSV
                          </button>
                        )}
                        {hasResultCheckupDownload && (
                          <button
                            onClick={() => {
                              setShowResultDownloadMenu(false)
                              handleDownloadSingleCheckup(currentResult)
                            }}
                            className="w-full text-left px-3 py-2 text-sm"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            Checkup
                          </button>
                        )}
                        {hasResultGenerationDownload && (
                          <button
                            onClick={() => {
                              setShowResultDownloadMenu(false)
                              handleDownloadSingleConfigGenerationJson(currentResult)
                            }}
                            className="w-full text-left px-3 py-2 text-sm"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            Generation
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="rounded-lg p-4 overflow-auto" style={{ backgroundColor: theme === 'dark' ? '#1e1e2e' : '#f8fafc', border: `1px solid ${theme === 'dark' ? '#313244' : '#e2e8f0'}` }}>
                <pre className="text-sm whitespace-pre-wrap font-mono" style={{ color: theme === 'dark' ? '#cdd6f4' : '#1e293b' }}>
                  {JSON.stringify(currentResult.result, null, 2)}
                </pre>
              </div>
            </div>
          ) : (
            <div>
              <div className="mb-4 p-3 rounded-lg flex items-center gap-2" style={{ backgroundColor: theme === 'dark' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                <svg className="w-5 h-5" style={{ color: '#ef4444' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span className="font-medium" style={{ color: '#ef4444' }}>Parse failed</span>
                {currentResult && (
                  <span className="text-sm ml-auto truncate" style={{ color: 'var(--text-muted)' }}>
                    {currentResult.templateName ? `${currentResult.templateName} · ${currentResult.fileName}` : currentResult.fileName}
                  </span>
                )}
              </div>
              <div className="rounded-lg p-4" style={{ backgroundColor: theme === 'dark' ? '#1c1917' : '#fef2f2', border: `1px solid ${theme === 'dark' ? '#292524' : '#fecaca'}` }}>
                {currentResult?.errorType && (
                  <p className="font-mono text-sm mb-2 font-semibold" style={{ color: '#ef4444' }}>{currentResult.errorType}</p>
                )}
                <pre className="text-sm whitespace-pre-wrap font-mono" style={{ color: theme === 'dark' ? '#d6d3d1' : '#57534e' }}>{currentResult?.error}</pre>
              </div>
            </div>
          )}
        </div>
        </div>

        <div className="border-l overflow-auto min-h-0" style={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
          <div className="p-2 h-full">
            {fileResults.length === 0 ? (
              <div className="h-full flex items-center justify-center text-center px-2" style={{ color: 'var(--text-muted)' }}>
                <p className="text-sm">No result items</p>
              </div>
            ) : isMergedView ? (
              <div className="space-y-0.5">
                {mergedResults.map((group, index) => {
                  const groupState = getMergedResultState(group)

                  return (
                    <div
                      key={`${group.fileId}-${index}`}
                      onClick={() => setSelectedMergedResultIndex(index)}
                      className="px-2 py-1.5 rounded-md cursor-pointer transition-colors"
                      style={{
                        backgroundColor: selectedMergedResultIndex === index ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                        border: selectedMergedResultIndex === index ? '1px solid rgba(59, 130, 246, 0.5)' : '1px solid transparent'
                      }}
                    >
                      <div className="flex items-start gap-2">
                        {groupState === 'success' ? (
                          <svg className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#22c55e' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : groupState === 'error' ? (
                          <svg className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#ef4444' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#f59e0b' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M4.93 19h14.14c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.2 16c-.77 1.33.19 3 1.73 3z" />
                          </svg>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{group.fileName}</p>
                          <p className="text-sm truncate" style={{ color: 'var(--text-muted)' }}>
                            {group.successfulCount} OK · {group.failedCount} Failed · {group.results.length} Templates
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="space-y-0.5">
                {individualResultGroups.map((group) => {
                  const isCollapsed = collapsedResultFileGroups[group.fileId] ?? false
                  const hasSelectedChild = group.items.some((item) => item.index === selectedResultIndex)

                  return (
                    <div key={group.fileId} className="space-y-0.5">
                      <div
                        onClick={() => toggleResultFileGroup(group.fileId)}
                        className="px-2 py-1.5 rounded-md cursor-pointer transition-colors"
                        style={{
                          backgroundColor: hasSelectedChild ? 'rgba(59, 130, 246, 0.14)' : 'transparent',
                          border: hasSelectedChild ? '1px solid rgba(59, 130, 246, 0.35)' : '1px solid transparent'
                        }}
                      >
                        <div className="flex items-start gap-2">
                          <span className="mt-0.5" style={{ color: 'var(--text-muted)' }}>
                            <ResultChevronIcon expanded={!isCollapsed} />
                          </span>
                          <span className="mt-0.5" style={{ color: 'var(--text-muted)' }}>
                            <ResultFolderIcon />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{group.fileName}</p>
                            <p className="text-sm truncate" style={{ color: 'var(--text-muted)' }}>
                              {group.successfulCount} OK · {group.failedCount} Failed
                            </p>
                          </div>
                        </div>
                      </div>
                      {!isCollapsed && (
                        <div className="space-y-0.5">
                          {group.items.map(({ result, index }) => (
                            <div
                              key={`${result.fileId}-${result.templateId || 'template'}-${index}`}
                              onClick={() => setSelectedResultIndex(index)}
                              className="ml-3 px-2 py-1 rounded-md cursor-pointer transition-colors"
                              style={{
                                backgroundColor: selectedResultIndex === index ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                                border: selectedResultIndex === index ? '1px solid rgba(59, 130, 246, 0.5)' : '1px solid transparent'
                              }}
                            >
                              <div className="flex items-start gap-2">
                                {result.success ? (
                                  <svg className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#22c55e' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                ) : (
                                  <svg className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#ef4444' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                )}
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                                    {result.templateName || 'Result'}
                                  </p>
                                  <p className="text-sm truncate" style={{ color: 'var(--text-muted)' }}>
                                    {result.success ? 'OK' : 'Failed'}
                                  </p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {showTemplateSelector && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.45)' }}
          onClick={() => setShowTemplateSelector(false)}
        >
          <div
            className="w-full max-w-xl max-h-[85vh] rounded-lg border shadow-xl overflow-hidden flex flex-col"
            style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-color)' }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-4 py-3 border-b flex items-center gap-3" style={{ borderColor: 'var(--border-color)' }}>
              <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Templates</h3>
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {selectedTemplates.length}/{totalTemplateOptions} selected
              </span>
              <button
                onClick={handleSelectAllTemplates}
                className="inline-flex items-center justify-center w-6 h-6 rounded transition-colors"
                style={{ color: 'var(--accent-primary)' }}
                disabled={totalTemplateOptions === 0}
                title="Select all templates"
                aria-label="Select all templates"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v2m10-4h2a2 2 0 012 2v2M9 19H7a2 2 0 01-2-2v-2m10 4h2a2 2 0 002-2v-2M8 12l2.5 2.5L16 9" />
                </svg>
              </button>
              <button
                onClick={() => setShowTemplateSelector(false)}
                className="ml-auto inline-flex items-center justify-center w-7 h-7 rounded transition-colors"
                style={{ color: 'var(--text-muted)' }}
                title="Close"
                aria-label="Close"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-auto p-4">
              {currentTemplateOption && (
                <div
                  onClick={() => toggleTemplateSelection(currentTemplateOption.id)}
                  className="mb-2 p-2 rounded-md cursor-pointer transition-colors"
                  style={{
                    backgroundColor: selectedTemplateIds.includes(currentTemplateOption.id) ? 'rgba(59, 130, 246, 0.18)' : 'transparent',
                    border: selectedTemplateIds.includes(currentTemplateOption.id) ? '1px solid rgba(59, 130, 246, 0.45)' : '1px solid transparent'
                  }}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedTemplateIds.includes(currentTemplateOption.id)}
                      readOnly
                      className="h-3.5 w-3.5 accent-blue-500"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{currentTemplateOption.name}</p>
                      <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>Unsaved current template</p>
                    </div>
                  </div>
                </div>
              )}

              <TemplateDirectoryTree
                title=""
                vendors={vendors}
                categories={parseCategories}
                templates={savedTemplateOptions}
                loading={isLoadingTemplates || isLoadingTemplateDirectories}
                emptyText="No saved templates"
                selectedTemplateIds={selectedTemplateIds}
                multiSelect
                onTemplateToggle={toggleTemplateSelection}
              />
            </div>

            <div className="px-4 py-3 border-t flex items-center justify-between gap-3" style={{ borderColor: 'var(--border-color)' }}>
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Selection is saved automatically.
              </span>
              <button
                onClick={() => setShowTemplateSelector(false)}
                className="btn"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
