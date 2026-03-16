import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { useStore, FileParseResult, UploadedFile } from '../../store/useStore'
import { parseText } from '../../services/api'
import JSZip from 'jszip'
import { saveAs } from 'file-saver'

interface TemplateSource {
  id: string
  name: string
  template: string
  source: 'current' | 'saved'
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function sanitizeFileNameSegment(value: string): string {
  return value.replace(/[<>:"/\\|?*\s]+/g, '_').replace(/^_+|_+$/g, '')
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

function hasDownloadableResult(result: Pick<FileParseResult, 'success' | 'result'>): boolean {
  return result.success && result.result !== undefined && result.result !== null
}

function hasDownloadableCsvResult(result: Pick<FileParseResult, 'success' | 'csvResult'>): boolean {
  return result.success && typeof result.csvResult === 'string'
}

function getCsvContent(result: Pick<FileParseResult, 'csvResult'>): string {
  return result.csvResult || ''
}

export default function TestResults() {
  const {
    generatedTemplate,
    savedTemplates,
    isLoadingTemplates,
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

  const templateOptions = useMemo<TemplateSource[]>(() => {
    const savedOptions = savedTemplates
      .filter((tpl) => tpl.generatedTemplate.trim())
      .map((tpl) => ({
        id: tpl.id,
        name: tpl.name,
        template: tpl.generatedTemplate,
        source: 'saved' as const
      }))

    if (!generatedTemplate.trim()) {
      return savedOptions
    }

    const currentMatchesSaved = savedOptions.some((option) => option.template === generatedTemplate)
    if (currentMatchesSaved) {
      return savedOptions
    }

    return [
      {
        id: 'current-template',
        name: templateName || 'Current Template',
        template: generatedTemplate,
        source: 'current'
      },
      ...savedOptions
    ]
  }, [generatedTemplate, savedTemplates, templateName])

  useEffect(() => {
    const optionIds = templateOptions.map((option) => option.id)

    setSelectedTemplateIds((prev) => {
      const kept = prev.filter((id) => optionIds.includes(id))
      if (kept.length > 0) {
        return kept
      }

      const preferredId = templateOptions.find((option) => option.source === 'current' || option.name === templateName)?.id
      return preferredId ? [preferredId] : optionIds.slice(0, 1)
    })
  }, [templateOptions, templateName])

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

    const kept = (selectedTestFileIds || []).filter((id) => fileIds.includes(id))
    const nextSelectedFileIds = kept.length > 0 ? kept : fileIds

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

  const selectedTemplates = useMemo(
    () => templateOptions.filter((option) => selectedTemplateIds.includes(option.id)),
    [templateOptions, selectedTemplateIds]
  )

  const selectedFiles = useMemo(
    () => files.filter((file) => (selectedTestFileIds || []).includes(file.id)),
    [files, selectedTestFileIds]
  )

  const previewFile = files.find((file) => file.id === selectedFileId) ?? null

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

  const currentResult = fileResults[selectedResultIndex] || fileResults[0]
  const successfulCount = fileResults.filter((result) => result.success).length
  const failedCount = fileResults.filter((result) => result.success === false).length
  const canRun = !isLoadingTemplates && selectedTemplates.length > 0 && (selectedFiles.length > 0 || (!files.length && !!inputText.trim()))

  return (
    <div className="flex flex-col h-full text-sm" style={{ backgroundColor: 'var(--bg-primary)', fontSize: '14px' }}>
      <div className="page-header">
        <h2 style={{ fontSize: '14px' }}>Test & Results</h2>
        <div className="flex gap-2 items-center">
          <div className="hidden md:flex items-center gap-2 mr-4">
            <span className="text-sm px-2 py-1 rounded" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
              Templates {selectedTemplates.length}/{templateOptions.length}
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
          {fileResults.length > 0 && (fileResults.some(hasDownloadableResult) || fileResults.some(hasDownloadableCsvResult)) && (
            <>
              {fileResults.some(hasDownloadableResult) && (
                <button
                  onClick={handleDownloadAllJson}
                  className="btn flex items-center gap-1"
                  title="Download all results as JSON ZIP"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download JSON
                </button>
              )}
              {fileResults.some(hasDownloadableCsvResult) && (
                <button
                  onClick={handleDownloadAllCsv}
                  className="btn flex items-center gap-1"
                  title="Download all results as CSV ZIP"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download CSV
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div
        className="flex-1 grid min-h-0"
        style={{
          gridTemplateColumns: '11rem minmax(0, 1fr) 11rem minmax(0, 1fr)',
          gridTemplateRows: 'auto minmax(0, 1fr)'
        }}
      >
        <div className="border-r flex flex-col row-span-2" style={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
          <div className="border-b p-2 max-h-52 overflow-auto" style={{ borderColor: 'var(--border-color)' }}>
            <div className="flex items-center justify-between mb-2 px-1">
              <h4 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Templates</h4>
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {selectedTemplates.length}/{templateOptions.length}
              </span>
            </div>
            {isLoadingTemplates ? (
              <p className="text-sm px-1 py-3 text-center" style={{ color: 'var(--text-muted)' }}>
                Loading templates...
              </p>
            ) : templateOptions.length === 0 ? (
              <p className="text-sm px-1 py-3 text-center" style={{ color: 'var(--text-muted)' }}>
                No templates
              </p>
            ) : (
              <div className="space-y-1">
                {templateOptions.map((template) => {
                  const isSelected = selectedTemplateIds.includes(template.id)
                  return (
                    <div
                      key={template.id}
                      onClick={() => toggleTemplateSelection(template.id)}
                      className="p-2 rounded-md cursor-pointer transition-colors"
                      style={{
                        backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.18)' : 'transparent',
                        border: isSelected ? '1px solid rgba(59, 130, 246, 0.45)' : '1px solid transparent'
                      }}
                      title={template.name}
                    >
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          readOnly
                          className="mt-0.5 h-3.5 w-3.5 accent-blue-500"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{template.name}</p>
                          <p className="text-sm truncate" style={{ color: 'var(--text-muted)' }}>
                            {template.source === 'current' ? 'Current' : 'Saved'}
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
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
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {(selectedTestFileIds || []).length}/{files.length}
              </span>
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

        <div className="border-r overflow-auto" style={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
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
                {hasDownloadableResult(currentResult) && (
                  <button
                    onClick={() => handleDownloadSingleJson(currentResult)}
                    className="btn text-sm flex items-center gap-1"
                    title="Download as JSON"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    JSON
                  </button>
                )}
                {hasDownloadableCsvResult(currentResult) && (
                  <button
                    onClick={() => handleDownloadSingleCsv(currentResult)}
                    className="btn text-sm flex items-center gap-1"
                    title="Download as CSV"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    CSV
                  </button>
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
    </div>
  )
}
