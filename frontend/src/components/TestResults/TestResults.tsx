import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { useStore, buildGenerationSourceTemplates, type FileParseResult, type UploadedFile } from '../../store/useStore'
import { parseText } from '../../services/api'
import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import TemplateDirectoryTree from '../TemplateDirectoryTree'
import { formatFileSize, sanitizeFileNameSegment } from '../../utils'

interface TemplateSource {
  id: string
  name: string
  template: string
  vendor: string
  categoryPath: string[]
  description?: string
  source: 'current' | 'saved'
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

  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([])
  const [showDownloadMenu, setShowDownloadMenu] = useState(false)
  const [showResultDownloadMenu, setShowResultDownloadMenu] = useState(false)
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

  const canDownloadConfigGeneration = groupedConfigGenerationPayloads.length > 0

  const onDrop = useCallback((acceptedFiles: File[]) => {
    clearFileResults()

    acceptedFiles.forEach((file, index) => {
      const reader = new FileReader()
      reader.onload = () => {
        const content = reader.result as string
        const newFile: UploadedFile = {
          id: `file-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 9)}`,
          name: file.name,
          size: file.size,
          content
        }

        addFile(newFile)
        setSelectedTestFileIds((current) => {
          if (current === null) {
            return [newFile.id]
          }
          return current.includes(newFile.id) ? current : [...current, newFile.id]
        })

        if (index === 0) {
          selectFile(newFile.id)
        }
      }
      reader.readAsText(file)
    })
  }, [addFile, clearFileResults, selectFile, setSelectedTestFileIds])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/*': ['.txt', '.log', '.cfg', '.conf', '.json', '.xml', '.yaml', '.yml'],
      'application/*': ['.cfg', '.conf']
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

  const handleRemoveFile = (id: string) => {
    removeFile(id)
    setSelectedTestFileIds((prev) => prev?.filter((fileId) => fileId !== id) ?? null)
    clearFileResults()
    setSelectedResultIndex(0)
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
  const successfulCount = fileResults.filter((result) => result.success).length
  const failedCount = fileResults.filter((result) => result.success === false).length
  const hasBulkJsonDownload = fileResults.some(hasDownloadableResult)
  const hasBulkCsvDownload = fileResults.some(hasDownloadableCsvResult)
  const hasBulkCheckupDownload = fileResults.some(hasDownloadableCheckupResult)
  const hasBulkDownloads = hasBulkJsonDownload || hasBulkCsvDownload || hasBulkCheckupDownload || canDownloadConfigGeneration
  const hasResultJsonDownload = currentResult ? hasDownloadableResult(currentResult) : false
  const hasResultCsvDownload = currentResult ? hasDownloadableCsvResult(currentResult) : false
  const hasResultCheckupDownload = currentResult ? hasDownloadableCheckupResult(currentResult) : false
  const hasResultGenerationDownload = currentResult ? hasDownloadableResult(currentResult) && hasSavedTemplateResult(currentResult) : false
  const hasResultDownloads = hasResultJsonDownload || hasResultCsvDownload || hasResultCheckupDownload || hasResultGenerationDownload
  const canRun = !isLoadingTemplates && selectedTemplates.length > 0 && (selectedFiles.length > 0 || (!files.length && !!inputText.trim()))

  return (
    <div className="flex flex-col h-full text-sm" style={{ backgroundColor: 'var(--bg-primary)', fontSize: '14px' }}>
      <div className="page-header">
        <h2 style={{ fontSize: '14px' }}>Test & Results</h2>
        <div className="flex gap-2 items-center">
          <div className="hidden md:flex items-center gap-2 mr-4">
            <span className="text-sm px-2 py-1 rounded" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
              Templates {selectedTemplates.length}/{savedTemplateOptions.length + (currentTemplateOption ? 1 : 0)}
            </span>
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
          gridTemplateColumns: '14rem minmax(0, 1fr) minmax(0, 1fr) 14rem',
          gridTemplateRows: 'auto minmax(0, 1fr)'
        }}
      >
        <div className="border-r flex flex-col row-span-2" style={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
          <div className="border-b p-2 max-h-52 overflow-auto" style={{ borderColor: 'var(--border-color)' }}>
            <div className="flex items-center justify-between mb-2 px-1">
              <h4 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Templates</h4>
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {selectedTemplates.length}/{savedTemplateOptions.length + (currentTemplateOption ? 1 : 0)}
              </span>
            </div>
            {currentTemplateOption && (
              <div
                onClick={() => toggleTemplateSelection(currentTemplateOption.id)}
                className="mb-2 p-2 rounded-md cursor-pointer transition-colors"
                style={{
                  backgroundColor: selectedTemplateIds.includes(currentTemplateOption.id) ? 'rgba(59, 130, 246, 0.18)' : 'transparent',
                  border: selectedTemplateIds.includes(currentTemplateOption.id) ? '1px solid rgba(59, 130, 246, 0.45)' : '1px solid transparent'
                }}
              >
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selectedTemplateIds.includes(currentTemplateOption.id)}
                    readOnly
                    className="mt-0.5 h-3.5 w-3.5 accent-blue-500"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{currentTemplateOption.name}</p>
                    <p className="text-xs truncate mt-1" style={{ color: 'var(--text-muted)' }}>Unsaved current template</p>
                  </div>
                </div>
              </div>
            )}
            <TemplateDirectoryTree
              title="Saved Templates"
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
                {isDragActive ? 'Drop files here' : 'Drop Files\nor click'}
              </p>
            </div>
          </div>

          <div className="flex-1 overflow-auto p-2">
            <div className="flex items-center justify-between mb-2 px-1">
              <h4 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Files</h4>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSelectAllFiles}
                  className="text-xs"
                  style={{ color: 'var(--accent-primary)' }}
                  disabled={files.length === 0}
                >
                  Select All
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
              <div className="space-y-1">
                {files.map((file) => {
                  const isSelected = (selectedTestFileIds || []).includes(file.id)
                  const isPreviewed = selectedFileId === file.id

                  return (
                    <div
                      key={file.id}
                      onClick={() => selectFile(file.id)}
                      className="p-2 rounded-md cursor-pointer group transition-colors"
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
        </div>

        <div className="border-r flex flex-col min-w-0 row-span-2" style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-color)' }}>
          <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border-color)' }}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Config Preview</h3>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {previewFile ? previewFile.name : 'Click a file to preview'}
                </p>
              </div>
              {previewFile && (
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
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

        <div className="col-span-2 px-4 py-2 border-b flex items-center gap-4 min-w-0" style={{ borderColor: 'var(--border-color)' }}>
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
            </>
          ) : (
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>No results yet</span>
          )}
        </div>

        <div className="overflow-auto p-4 min-w-0" style={{ backgroundColor: 'var(--bg-primary)' }}>
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

        <div className="border-l overflow-auto" style={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
          <div className="p-2 h-full">
            {fileResults.length === 0 ? (
              <div className="h-full flex items-center justify-center text-center px-2" style={{ color: 'var(--text-muted)' }}>
                <p className="text-sm">No result items</p>
              </div>
            ) : (
              <div className="space-y-1">
                {fileResults.map((result, index) => (
                  <div
                    key={`${result.fileId}-${result.templateId || 'template'}-${index}`}
                    onClick={() => setSelectedResultIndex(index)}
                    className="p-2 rounded-md cursor-pointer transition-colors"
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
                        <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{result.fileName}</p>
                        {result.templateName && (
                          <p className="text-sm truncate" style={{ color: 'var(--text-muted)' }}>{result.templateName}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
