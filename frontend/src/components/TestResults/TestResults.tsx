import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import TemplateDirectoryTree from '../TemplateDirectoryTree'
import { formatFileSize } from '../../utils'
import { useStore } from '../../store/useStore'
import {
  createBatchParseJob,
  getBatchParseJob,
  getBatchParseResultsPage,
  parseText,
  type BatchParseJob,
  type BatchParseResultsPage,
  type BatchParseTemplatePayload,
  type ParseResult
} from '../../services/api'

interface TemplateSource {
  id: string
  name: string
  template: string
  vendor: string
  categoryPath: string[]
  description?: string
  source: 'current' | 'saved'
}

interface UploadedBatchFile {
  id: string
  file: File
  name: string
  size: number
  isArchive: boolean
}

interface QuickParseItem {
  templateId: string
  templateName: string
  result: ParseResult
}

interface DisplayResultItem {
  key: string
  source: 'batch' | 'quick'
  templateName: string
  fileName: string
  success: boolean
  error?: string
  errorType?: string
  result?: unknown
  csvResult?: string
  checkupCsvResult?: string
}

const TEST_RESULTS_SELECTED_TEMPLATE_IDS_STORAGE_KEY = 'ttp-test-results-selected-template-ids'
const TEST_RESULTS_LAST_JOB_ID_STORAGE_KEY = 'ttp-test-results-last-job-id'
const RESULTS_PAGE_SIZE = 50

function createUploadId() {
  return `upload-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

function getPathExtension(path: string): string {
  const normalizedPath = path.replace(/\\/g, '/')
  const fileName = normalizedPath.split('/').pop() || normalizedPath
  const extensionIndex = fileName.lastIndexOf('.')
  return extensionIndex >= 0 ? fileName.slice(extensionIndex).toLowerCase() : ''
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

function loadStoredJobId(): string | null {
  if (typeof window === 'undefined') {
    return null
  }

  const rawValue = window.localStorage.getItem(TEST_RESULTS_LAST_JOB_ID_STORAGE_KEY)
  return rawValue && rawValue.trim() ? rawValue : null
}

function setStoredJobId(jobId: string | null) {
  if (typeof window === 'undefined') {
    return
  }

  if (!jobId) {
    window.localStorage.removeItem(TEST_RESULTS_LAST_JOB_ID_STORAGE_KEY)
    return
  }

  window.localStorage.setItem(TEST_RESULTS_LAST_JOB_ID_STORAGE_KEY, jobId)
}

function getProgressPercent(job: BatchParseJob | null): number {
  if (!job || job.totalTasks === 0) {
    return 0
  }
  return Math.min(100, Math.round((job.completedTasks / job.totalTasks) * 100))
}

function getScanProgressPercent(job: BatchParseJob | null): number {
  if (!job) {
    return 0
  }

  if (job.totalArchiveEntries > 0) {
    return Math.min(100, Math.round((job.processedArchiveEntries / job.totalArchiveEntries) * 100))
  }

  if (job.totalUploads > 0) {
    return Math.min(100, Math.round((job.scannedUploads / job.totalUploads) * 100))
  }

  return 0
}

function getActiveProgressPercent(job: BatchParseJob | null, isSubmittingBatch: boolean, uploadProgressPercent: number): number {
  if (isSubmittingBatch) {
    return uploadProgressPercent
  }

  if (!job) {
    return 0
  }

  if (job.status === 'scanning') {
    return getScanProgressPercent(job)
  }

  if (job.status === 'parsing' || job.status === 'completed') {
    return getProgressPercent(job)
  }

  return 0
}

function getStatusTone(status?: BatchParseJob['status']): { label: string; color: string; bg: string } {
  switch (status) {
    case 'completed':
      return { label: 'Completed', color: '#15803d', bg: 'rgba(34, 197, 94, 0.12)' }
    case 'failed':
      return { label: 'Failed', color: '#b91c1c', bg: 'rgba(239, 68, 68, 0.12)' }
    case 'parsing':
      return { label: 'Parsing', color: '#1d4ed8', bg: 'rgba(59, 130, 246, 0.12)' }
    case 'scanning':
      return { label: 'Scanning', color: '#7c3aed', bg: 'rgba(124, 58, 237, 0.12)' }
    case 'queued':
      return { label: 'Queued', color: '#92400e', bg: 'rgba(245, 158, 11, 0.12)' }
    default:
      return { label: 'Idle', color: '#475569', bg: 'rgba(148, 163, 184, 0.12)' }
  }
}

function ResultStatePill({ success }: { success: boolean }) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
      style={{
        color: success ? '#15803d' : '#b91c1c',
        backgroundColor: success ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)'
      }}
    >
      {success ? 'Success' : 'Failed'}
    </span>
  )
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
    inputText,
    setInputText
  } = useStore()

  const [uploads, setUploads] = useState<UploadedBatchFile[]>([])
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>(() => loadStoredSelectedTemplateIds())
  const [isSubmittingBatch, setIsSubmittingBatch] = useState(false)
  const [uploadProgressPercent, setUploadProgressPercent] = useState(0)
  const [batchJob, setBatchJob] = useState<BatchParseJob | null>(null)
  const [batchResultsPage, setBatchResultsPage] = useState<BatchParseResultsPage | null>(null)
  const [batchResultsOffset, setBatchResultsOffset] = useState(0)
  const [batchError, setBatchError] = useState<string | null>(null)
  const [showTemplateSelector, setShowTemplateSelector] = useState(false)
  const [showDownloadMenu, setShowDownloadMenu] = useState(false)
  const [quickParseResults, setQuickParseResults] = useState<QuickParseItem[]>([])
  const [isQuickParsing, setIsQuickParsing] = useState(false)
  const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null)
  const [uploadPreviewContent, setUploadPreviewContent] = useState('')
  const [isLoadingUploadPreview, setIsLoadingUploadPreview] = useState(false)
  const [uploadPreviewError, setUploadPreviewError] = useState<string | null>(null)
  const [selectedResultIndex, setSelectedResultIndex] = useState(0)

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
      description: 'Unsaved template from Template Builder',
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

  const selectedTemplates = useMemo(() => {
    const options = currentTemplateOption ? [currentTemplateOption, ...savedTemplateOptions] : savedTemplateOptions
    return options.filter((option) => selectedTemplateIds.includes(option.id))
  }, [currentTemplateOption, savedTemplateOptions, selectedTemplateIds])

  const batchTemplates = useMemo<BatchParseTemplatePayload[]>(() => (
    selectedTemplates.map((template) => ({
      id: template.id,
      name: template.name,
      template: template.template
    }))
  ), [selectedTemplates])

  const restoreJob = useCallback(async (jobId: string) => {
    try {
      const job = await getBatchParseJob(jobId)
      setBatchJob(job)
      if (job.status === 'completed' || job.status === 'failed') {
        const page = await getBatchParseResultsPage(job.id, 0, RESULTS_PAGE_SIZE)
        setBatchResultsPage(page)
        setBatchResultsOffset(0)
      }
      setBatchError(null)
    } catch (error) {
      setStoredJobId(null)
      setBatchError(error instanceof Error ? error.message : 'Failed to restore previous batch job')
    }
  }, [])

  useEffect(() => {
    const storedJobId = loadStoredJobId()
    if (!storedJobId) {
      return
    }
    void restoreJob(storedJobId)
  }, [restoreJob])

  useEffect(() => {
    if (!batchJob || (batchJob.status !== 'queued' && batchJob.status !== 'scanning' && batchJob.status !== 'parsing')) {
      return
    }

    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const refreshed = await getBatchParseJob(batchJob.id)
          setBatchJob(refreshed)
          if (refreshed.status === 'completed' || refreshed.status === 'failed') {
            const page = await getBatchParseResultsPage(refreshed.id, 0, RESULTS_PAGE_SIZE)
            setBatchResultsPage(page)
            setBatchResultsOffset(0)
          }
        } catch (error) {
          setBatchError(error instanceof Error ? error.message : 'Failed to refresh batch job')
        }
      })()
    }, 2000)

    return () => {
      window.clearInterval(timer)
    }
  }, [batchJob])

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) {
      return
    }

    setQuickParseResults([])
    setBatchError(null)
    setUploads((current) => [
      ...current,
      ...acceptedFiles.map((file) => ({
        id: createUploadId(),
        file,
        name: file.name,
        size: file.size,
        isArchive: getPathExtension(file.name) === '.zip'
      }))
    ])
  }, [])

  useEffect(() => {
    if (uploads.length === 0) {
      setSelectedUploadId(null)
      setUploadPreviewContent('')
      setUploadPreviewError(null)
      return
    }

    if (!selectedUploadId || !uploads.some((upload) => upload.id === selectedUploadId)) {
      setSelectedUploadId(uploads[0].id)
    }
  }, [selectedUploadId, uploads])

  const selectedUpload = useMemo(
    () => uploads.find((upload) => upload.id === selectedUploadId) || null,
    [selectedUploadId, uploads]
  )

  useEffect(() => {
    if (!selectedUpload) {
      return
    }

    if (selectedUpload.isArchive) {
      setUploadPreviewContent('')
      setUploadPreviewError('Zip archives are processed on the server. Preview is unavailable before submission.')
      setIsLoadingUploadPreview(false)
      return
    }

    let cancelled = false
    setIsLoadingUploadPreview(true)
    setUploadPreviewError(null)

    void selectedUpload.file.text()
      .then((text) => {
        if (cancelled) {
          return
        }
        setUploadPreviewContent(text)
      })
      .catch((error) => {
        if (cancelled) {
          return
        }
        setUploadPreviewContent('')
        setUploadPreviewError(error instanceof Error ? error.message : 'Failed to read file preview')
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingUploadPreview(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [selectedUpload])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/*': ['.txt', '.log', '.cfg', '.conf', '.json', '.xml', '.yaml', '.yml'],
      'application/*': ['.cfg', '.conf', '.zip'],
      'application/zip': ['.zip']
    },
    multiple: true
  })

  const handleRemoveUpload = (id: string) => {
    setUploads((current) => current.filter((upload) => upload.id !== id))
  }

  const handleClearUploads = () => {
    setUploads([])
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

  const handleStartBatch = async () => {
    if (batchTemplates.length === 0) {
      setBatchError('Please select at least one template.')
      return
    }

    if (uploads.length === 0) {
      setBatchError('Please upload at least one file or zip archive.')
      return
    }

    setIsSubmittingBatch(true)
    setUploadProgressPercent(0)
    setBatchError(null)
    setBatchResultsPage(null)
    setBatchResultsOffset(0)
    setQuickParseResults([])

    try {
      const job = await createBatchParseJob(batchTemplates, uploads.map((upload) => upload.file), {
        onUploadProgress: (progressPercent) => {
          setUploadProgressPercent(progressPercent)
        }
      })
      setBatchJob(job)
      setStoredJobId(job.id)
    } catch (error) {
      setBatchError(error instanceof Error ? error.message : 'Failed to start batch parse job')
    } finally {
      setIsSubmittingBatch(false)
      setUploadProgressPercent(0)
    }
  }

  const handleLoadResultsPage = async (nextOffset: number) => {
    if (!batchJob) {
      return
    }

    try {
      const page = await getBatchParseResultsPage(batchJob.id, nextOffset, RESULTS_PAGE_SIZE)
      setBatchResultsPage(page)
      setBatchResultsOffset(nextOffset)
      setBatchError(null)
    } catch (error) {
      setBatchError(error instanceof Error ? error.message : 'Failed to load batch results')
    }
  }

  const handleQuickParse = async () => {
    if (batchTemplates.length === 0) {
      setBatchError('Please select at least one template.')
      return
    }

    if (!inputText.trim()) {
      setBatchError('Please enter text for quick parsing.')
      return
    }

    setIsQuickParsing(true)
    setBatchError(null)
    setQuickParseResults([])

    try {
      const results: QuickParseItem[] = []
      for (const template of batchTemplates) {
        const result = await parseText(inputText, template.template)
        results.push({
          templateId: template.id,
          templateName: template.name,
          result
        })
      }
      setQuickParseResults(results)
    } catch (error) {
      setBatchError(error instanceof Error ? error.message : 'Quick parse failed')
    } finally {
      setIsQuickParsing(false)
    }
  }

  const statusTone = getStatusTone(batchJob?.status)
  const activeProgressPercent = getActiveProgressPercent(batchJob, isSubmittingBatch, uploadProgressPercent)
  const showProgressStrip = isSubmittingBatch || Boolean(batchJob)
  const progressTone = isSubmittingBatch
    ? { color: '#1d4ed8', bg: 'rgba(59, 130, 246, 0.16)' }
    : batchJob?.status === 'failed'
      ? { color: '#b91c1c', bg: 'rgba(239, 68, 68, 0.16)' }
      : batchJob?.status === 'completed'
        ? { color: '#15803d', bg: 'rgba(34, 197, 94, 0.16)' }
        : batchJob?.status === 'scanning'
          ? { color: '#7c3aed', bg: 'rgba(124, 58, 237, 0.16)' }
          : { color: '#1d4ed8', bg: 'rgba(59, 130, 246, 0.16)' }
  const progressTitle = isSubmittingBatch
    ? `Uploading files to backend · ${uploadProgressPercent}%`
    : batchJob
      ? `${statusTone.label} · ${batchJob.phaseMessage}`
      : 'Idle'
  const progressDetail = isSubmittingBatch
    ? `Preparing ${uploads.length} upload${uploads.length === 1 ? '' : 's'}`
    : batchJob && batchJob.status === 'scanning'
      ? `${batchJob.scannedUploads}/${batchJob.totalUploads} uploads scanned${
          batchJob.totalArchiveEntries > 0
            ? ` · ${batchJob.processedArchiveEntries}/${batchJob.totalArchiveEntries} archive entries inspected`
            : ''
        }`
      : batchJob && batchJob.status === 'parsing'
        ? `${batchJob.completedTasks}/${batchJob.totalTasks} parse tasks completed · ${batchJob.discoveredFileCount} discovered files`
        : batchJob && batchJob.status === 'completed'
          ? `${batchJob.completedTasks}/${batchJob.totalTasks} parse tasks completed · ${batchJob.successCount} succeeded · ${batchJob.failureCount} failed`
          : batchJob && batchJob.status === 'failed'
            ? batchJob.recentError?.error ? String(batchJob.recentError.error) : 'Batch parse failed'
            : batchJob
              ? `${batchJob.uploadCount} uploads queued`
              : ''
  const rawBatchResults = batchResultsPage?.items || batchJob?.previewResults || []
  const canGoPrev = batchResultsOffset > 0
  const canGoNext = batchResultsPage
    ? batchResultsOffset + batchResultsPage.items.length < batchResultsPage.total
    : false
  const totalTemplateOptions = savedTemplateOptions.length + (currentTemplateOption ? 1 : 0)
  const displayResults = useMemo<DisplayResultItem[]>(() => {
    const batchItems = rawBatchResults.map((item, index) => ({
      key: `batch-${String(item.template_id || item.template_name || item.templateName || 'template')}-${String(item.file_name || item.fileName || index)}`,
      source: 'batch' as const,
      templateName: String(item.template_name || item.templateName || '-'),
      fileName: String(item.file_name || item.fileName || '-'),
      success: Boolean(item.success),
      error: item.error ? String(item.error) : undefined,
      errorType: item.error_type ? String(item.error_type) : item.errorType ? String(item.errorType) : undefined,
      result: item.result,
      csvResult: typeof item.csv_result === 'string' ? item.csv_result : typeof item.csvResult === 'string' ? item.csvResult : undefined,
      checkupCsvResult: typeof item.checkup_csv_result === 'string'
        ? item.checkup_csv_result
        : typeof item.checkupCsvResult === 'string'
          ? item.checkupCsvResult
          : undefined
    }))

    if (batchItems.length > 0) {
      return batchItems
    }

    return quickParseResults.map((item) => ({
      key: `quick-${item.templateId}`,
      source: 'quick' as const,
      templateName: item.templateName,
      fileName: 'Manual Input',
      success: item.result.success,
      error: item.result.error,
      errorType: item.result.errorType,
      result: item.result.result,
      csvResult: item.result.csvResult,
      checkupCsvResult: item.result.checkupCsvResult
    }))
  }, [quickParseResults, rawBatchResults])

  useEffect(() => {
    if (displayResults.length === 0) {
      setSelectedResultIndex(0)
      return
    }

    setSelectedResultIndex((current) => Math.min(current, displayResults.length - 1))
  }, [displayResults])

  const currentResult = displayResults[selectedResultIndex] || displayResults[0] || null
  const successCount = displayResults.filter((item) => item.success).length
  const failedCount = displayResults.filter((item) => !item.success).length
  const hasDownloads = Boolean(batchJob?.artifactUrls.summary || batchJob?.artifactUrls.results || batchJob?.artifactUrls.errors)

  return (
    <div className="flex flex-col h-full text-sm relative" style={{ backgroundColor: 'var(--bg-primary)', fontSize: '14px' }}>
      <div className="page-header">
        <div className="flex items-center gap-3 min-w-0">
          <h2>Test & Results</h2>
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
              Files {uploads.length}
            </span>
            {batchJob && (
              <span className="text-sm px-2 py-1 rounded" style={{ backgroundColor: statusTone.bg, color: statusTone.color }}>
                {statusTone.label}
              </span>
            )}
          </div>
          <button onClick={handleClearUploads} className="btn" disabled={uploads.length === 0}>
            Clear
          </button>
          <button
            onClick={handleQuickParse}
            disabled={isQuickParsing || batchTemplates.length === 0}
            className="btn"
          >
            {isQuickParsing ? 'Parsing...' : 'Quick Parse'}
          </button>
          <button
            onClick={handleStartBatch}
            disabled={isSubmittingBatch || uploads.length === 0 || batchTemplates.length === 0}
            className="btn"
          >
            {isSubmittingBatch ? 'Submitting...' : 'Start Batch'}
          </button>
          {hasDownloads && (
            <div className="relative">
              <button
                onClick={() => setShowDownloadMenu((current) => !current)}
                className="btn flex items-center gap-1"
              >
                Download
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showDownloadMenu && (
                <div
                  className="absolute right-0 mt-2 min-w-44 rounded-md border shadow-lg z-20 overflow-hidden"
                  style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}
                >
                  {batchJob?.artifactUrls.summary && (
                    <a href={batchJob.artifactUrls.summary} className="block px-3 py-2 text-sm" style={{ color: 'var(--text-primary)' }}>
                      Summary
                    </a>
                  )}
                  {batchJob?.artifactUrls.results && (
                    <a href={batchJob.artifactUrls.results} className="block px-3 py-2 text-sm" style={{ color: 'var(--text-primary)' }}>
                      Results JSONL
                    </a>
                  )}
                  {batchJob?.artifactUrls.errors && (
                    <a href={batchJob.artifactUrls.errors} className="block px-3 py-2 text-sm" style={{ color: 'var(--text-primary)' }}>
                      Errors JSONL
                    </a>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {showProgressStrip && (
        <div
          className="px-4 py-3 border-b"
          style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="text-sm px-2 py-1 rounded whitespace-nowrap"
              style={{ backgroundColor: progressTone.bg, color: progressTone.color }}
            >
              {isSubmittingBatch ? 'Uploading' : statusTone.label}
            </span>
            <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>
              {progressTitle}
            </p>
            <span className="text-sm whitespace-nowrap ml-auto" style={{ color: 'var(--text-muted)' }}>
              {activeProgressPercent}%
            </span>
          </div>
          <div
            className="mt-2 h-2 rounded-full overflow-hidden"
            style={{ backgroundColor: 'var(--bg-tertiary)' }}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${activeProgressPercent}%`,
                backgroundColor: progressTone.color
              }}
            />
          </div>
          {progressDetail && (
            <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              {progressDetail}
            </p>
          )}
        </div>
      )}

      <div
        className="flex-1 grid min-h-0"
        style={{
          gridTemplateColumns: '14rem minmax(0, 1fr) minmax(0, 1fr) 14rem'
        }}
      >
        <div className="border-r flex flex-col min-h-0" style={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
          <div>
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
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  {uploads.length}
                </span>
              </div>
              {uploads.length === 0 ? (
                <p className="text-sm px-1 py-4 text-center" style={{ color: 'var(--text-muted)' }}>
                  No files
                </p>
	              ) : (
	                <div className="space-y-0.5">
                  {uploads.map((upload) => {
                    const isSelected = selectedUploadId === upload.id

                    return (
                      <div
                        key={upload.id}
                        onClick={() => setSelectedUploadId(upload.id)}
                        className="px-2 py-1.5 rounded-md cursor-pointer group transition-colors"
                        style={{
                          backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.18)' : 'transparent',
                          border: isSelected ? '1px solid rgba(59, 130, 246, 0.5)' : '1px solid transparent'
                        }}
                        title={upload.name}
                      >
                        <div className="flex items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{upload.name}</p>
                            <p className="text-sm truncate" style={{ color: 'var(--text-muted)' }}>
                              {formatFileSize(upload.size)} {upload.isArchive ? '· zip' : ''}
                            </p>
                          </div>
                          <button
                            onClick={(event) => {
                              event.stopPropagation()
                              handleRemoveUpload(upload.id)
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
	        </div>

        <div className="border-r flex flex-col min-w-0 min-h-0" style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-color)' }}>
          <div className="h-11 px-4 border-b flex items-center" style={{ borderColor: 'var(--border-color)' }}>
            <div className="flex items-center gap-3 min-w-0 w-full">
              <h3 className="text-sm font-medium whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>Config Preview</h3>
              <span className="text-sm truncate" style={{ color: 'var(--text-secondary)' }}>
                {selectedUpload ? selectedUpload.name : 'Manual input'}
              </span>
              {selectedUpload && (
                <span className="text-sm whitespace-nowrap ml-auto" style={{ color: 'var(--text-muted)' }}>
                  {formatFileSize(selectedUpload.size)}
                </span>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-auto p-4" style={{ backgroundColor: 'var(--surface-code)' }}>
            {selectedUpload ? (
              isLoadingUploadPreview ? (
                <div className="h-full flex items-center justify-center text-center px-6" style={{ color: 'var(--text-muted)' }}>
                  <p className="text-sm">Loading preview…</p>
                </div>
              ) : uploadPreviewError ? (
                <div className="h-full flex items-center justify-center text-center px-6" style={{ color: 'var(--text-muted)' }}>
                  <div>
                    <p className="text-sm mb-1">{uploadPreviewError}</p>
                    {selectedUpload.isArchive && (
                      <p className="text-sm">Archive contents are expanded only after the batch starts.</p>
                    )}
                  </div>
                </div>
              ) : (
                <pre className="text-sm whitespace-pre-wrap font-mono" style={{ color: '#cdd6f4' }}>
                  {uploadPreviewContent}
                </pre>
              )
            ) : (
              <textarea
                value={inputText}
                onChange={(event) => setInputText(event.target.value)}
                placeholder="Paste sample text here for quick parsing"
                className="w-full h-full min-h-[260px] bg-transparent border-none outline-none resize-none text-sm font-mono"
                style={{ color: '#cdd6f4' }}
              />
            )}
          </div>
        </div>

        <div className="flex flex-col min-w-0 min-h-0" style={{ backgroundColor: 'var(--bg-primary)' }}>
          <div className="h-11 px-4 border-b flex items-center gap-4 min-w-0" style={{ borderColor: 'var(--border-color)' }}>
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Results:</span>
            {displayResults.length > 0 ? (
              <>
                {successCount > 0 && (
                  <span className="text-sm flex items-center gap-1" style={{ color: '#22c55e' }}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {successCount} OK
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
                {batchJob && (
                  <span className="text-sm ml-auto truncate" style={{ color: 'var(--text-muted)' }}>
                    {batchJob.completedTasks}/{batchJob.totalTasks} tasks · {getProgressPercent(batchJob)}%
                  </span>
                )}
              </>
            ) : (
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>No results yet</span>
            )}
          </div>

          <div className="flex-1 overflow-auto p-4 min-w-0">
            {!displayResults.length ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center" style={{ color: 'var(--text-muted)' }}>
                  <svg className="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-sm mb-2">No results yet</p>
                  <p className="text-sm mb-2">1. Select one or more templates</p>
                  <p className="text-sm mb-2">2. Upload files or enter sample text</p>
                  <p className="text-sm">3. Click "Start Batch" or "Quick Parse"</p>
                  {selectedTemplates.length === 0 && (
                    <p className="text-sm mt-4" style={{ color: 'var(--error)' }}>No template selected</p>
                  )}
                </div>
              </div>
            ) : currentResult?.success ? (
              <div>
                <div className="mb-4 p-3 rounded-lg flex items-center gap-2" style={{ backgroundColor: 'var(--surface-success-bg)', border: '1px solid var(--surface-success-border)' }}>
                  <svg className="w-5 h-5" style={{ color: '#22c55e' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="font-medium" style={{ color: '#22c55e' }}>
                    {currentResult.source === 'batch' ? 'Parse successful' : 'Quick parse successful'}
                  </span>
                  <span className="text-sm ml-auto mr-2 truncate" style={{ color: 'var(--text-muted)' }}>
                    {currentResult.templateName} · {currentResult.fileName}
                  </span>
                </div>
                <div className="rounded-lg p-4 overflow-auto" style={{ backgroundColor: 'var(--surface-code)', border: '1px solid var(--surface-code-border)' }}>
                  <pre className="text-sm whitespace-pre-wrap font-mono" style={{ color: '#cdd6f4' }}>
                    {JSON.stringify(currentResult.result, null, 2)}
                  </pre>
                </div>
              </div>
            ) : (
              <div>
                <div className="mb-4 p-3 rounded-lg flex items-center gap-2" style={{ backgroundColor: 'var(--surface-error-bg)', border: '1px solid var(--surface-error-border)' }}>
                  <svg className="w-5 h-5" style={{ color: '#ef4444' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <span className="font-medium" style={{ color: '#ef4444' }}>
                    {currentResult?.source === 'batch' ? 'Parse failed' : 'Quick parse failed'}
                  </span>
                  {currentResult && (
                    <span className="text-sm ml-auto truncate" style={{ color: 'var(--text-muted)' }}>
                      {currentResult.templateName} · {currentResult.fileName}
                    </span>
                  )}
                </div>
                <div className="rounded-lg p-4" style={{ backgroundColor: 'var(--surface-error-panel)', border: '1px solid var(--surface-error-panel-border)' }}>
                  {currentResult?.errorType && (
                    <p className="font-mono text-sm mb-2 font-semibold" style={{ color: '#ef4444' }}>{currentResult.errorType}</p>
                  )}
                  <pre className="text-sm whitespace-pre-wrap font-mono" style={{ color: '#d6d3d1' }}>{currentResult?.error || 'Unknown error'}</pre>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="border-l overflow-auto min-h-0" style={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
          <div className="p-2 h-full">
            {displayResults.length === 0 ? (
              <div className="h-full flex items-center justify-center text-center px-2" style={{ color: 'var(--text-muted)' }}>
                <p className="text-sm">No result items</p>
              </div>
            ) : (
              <div className="space-y-0.5">
                {displayResults.map((item, index) => (
                  <div
                    key={item.key}
                    onClick={() => setSelectedResultIndex(index)}
                    className="px-2 py-1.5 rounded-md cursor-pointer transition-colors"
                    style={{
                      backgroundColor: selectedResultIndex === index ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                      border: selectedResultIndex === index ? '1px solid rgba(59, 130, 246, 0.5)' : '1px solid transparent'
                    }}
                  >
                    <div className="flex items-start gap-2">
                      <div className="mt-0.5">
                        <ResultStatePill success={item.success} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{item.templateName}</p>
                        <p className="text-sm truncate" style={{ color: 'var(--text-muted)' }}>{item.fileName}</p>
                        {!item.success && item.error && (
                          <p className="text-xs truncate mt-1" style={{ color: '#ef4444' }}>{item.error}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {batchResultsPage && (
                  <div className="flex items-center justify-between pt-3 px-1">
                    <button
                      type="button"
                      onClick={() => handleLoadResultsPage(Math.max(0, batchResultsOffset - RESULTS_PAGE_SIZE))}
                      disabled={!canGoPrev}
                      className="btn"
                    >
                      Prev
                    </button>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {batchResultsOffset + 1}-{batchResultsOffset + batchResultsPage.items.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleLoadResultsPage(batchResultsOffset + RESULTS_PAGE_SIZE)}
                      disabled={!canGoNext}
                      className="btn"
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {batchError && (
          <div
            className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-lg px-4 py-2 text-sm shadow-lg z-20"
            style={{ color: '#b91c1c', backgroundColor: 'rgba(239, 68, 68, 0.14)', border: '1px solid rgba(239, 68, 68, 0.28)' }}
          >
            {batchError}
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
                  <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Choose one or more templates for batch parsing.</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleSelectAllTemplates} className="btn">Toggle All</button>
                  <button onClick={() => setShowTemplateSelector(false)} className="btn">Close</button>
                </div>
              </div>

              <TemplateDirectoryTree
                title="Parse Templates"
                vendors={vendors}
                categories={parseCategories}
                templates={currentTemplateOption ? [currentTemplateOption, ...savedTemplateOptions] : savedTemplateOptions}
                loading={isLoadingTemplates || isLoadingTemplateDirectories}
                emptyText="No parse templates available."
                selectedTemplateIds={selectedTemplateIds}
                multiSelect
                onTemplateToggle={(templateId) => {
                  setSelectedTemplateIds((current) => (
                    current.includes(templateId)
                      ? current.filter((id) => id !== templateId)
                      : [...current, templateId]
                  ))
                }}
                renderTemplateMeta={(template) => (
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {template.source === 'current' ? 'Unsaved' : template.description || 'Saved template'}
                  </span>
                )}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
