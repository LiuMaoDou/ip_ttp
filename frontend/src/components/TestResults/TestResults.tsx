import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import TemplateDirectoryTree from '../TemplateDirectoryTree'
import { formatFileSize } from '../../utils'
import { useStore, type UploadedBatchFile, type Variable } from '../../store/useStore'
import {
  cancelBatchParseJob,
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
  variableNames?: string[]
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

type ResultViewSource = 'batch' | 'quick'

const TEST_RESULTS_SELECTED_TEMPLATE_IDS_STORAGE_KEY = 'ttp-test-results-selected-template-ids'
const TEST_RESULTS_LAST_JOB_ID_STORAGE_KEY = 'ttp-test-results-last-job-id'
const RESULTS_PAGE_SIZE = 50
const IDB_DB_NAME = 'ttp-web'
const IDB_STORE = 'batch-uploads'
const IDB_KEY = 'uploads'

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE) }
    req.onsuccess = () => { resolve(req.result) }
    req.onerror = () => { reject(req.error) }
  })
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openIDB()
  return new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key)
    req.onsuccess = () => { resolve(req.result as T) }
    req.onerror = () => { reject(req.error) }
  })
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openIDB()
  return new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).put(value, key)
    req.onsuccess = () => { resolve() }
    req.onerror = () => { reject(req.error) }
  })
}

async function idbDelete(key: string): Promise<void> {
  const db = await openIDB()
  return new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).delete(key)
    req.onsuccess = () => { resolve() }
    req.onerror = () => { reject(req.error) }
  })
}

function createUploadId() {
  return `upload-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

function getPathExtension(path: string): string {
  const normalizedPath = path.replace(/\\/g, '/')
  const fileName = normalizedPath.split('/').pop() || normalizedPath
  const extensionIndex = fileName.lastIndexOf('.')
  return extensionIndex >= 0 ? fileName.slice(extensionIndex).toLowerCase() : ''
}

function getLeafFileName(path: string): string {
  const normalizedPath = path.replace(/\\/g, '/')
  return normalizedPath.split('/').pop() || normalizedPath
}

function getResultFieldValue(value: unknown, fieldNames: string[], depth = 0): string | null {
  if (depth > 5 || value == null) {
    return null
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = getResultFieldValue(item, fieldNames, depth + 1)
      if (found) {
        return found
      }
    }
    return null
  }

  if (typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const normalizedFields = fieldNames.map((fieldName) => fieldName.toLowerCase())

  for (const [key, fieldValue] of Object.entries(record)) {
    const normalizedKey = key.toLowerCase().replace(/[\s-]+/g, '_')
    if (normalizedFields.includes(normalizedKey) && typeof fieldValue === 'string' && fieldValue.trim()) {
      return fieldValue.trim()
    }
  }

  for (const fieldValue of Object.values(record)) {
    const found = getResultFieldValue(fieldValue, fieldNames, depth + 1)
    if (found) {
      return found
    }
  }

  return null
}

function getDeviceNameFromInput(input: string): string | null {
  const hostnameMatch = input.match(/^\s*hostname\s+(\S+)/im)
  if (hostnameMatch?.[1]) {
    return hostnameMatch[1].trim()
  }

  const promptMatch = input.match(/^\s*([A-Za-z0-9][\w.-]{1,63})[>#]\s*$/m)
  return promptMatch?.[1]?.trim() || null
}

function getQuickParseDisplayName(result: ParseResult, input: string): string {
  const deviceName = getResultFieldValue(result.result, [
    'hostname',
    'host_name',
    'device_name',
    'device',
    'name',
    'sysname'
  ])

  return deviceName || getDeviceNameFromInput(input) || '手动输入'
}

function UploadedFileIcon() {
  return (
    <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 3.75h7.879a2 2 0 011.414.586l2.371 2.371A2 2 0 0119.25 8.12V18.25A2.75 2.75 0 0116.5 21h-9A2.75 2.75 0 014.75 18.25v-11.75A2.75 2.75 0 017.5 3.75z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 11h6M9 15h4.5" />
    </svg>
  )
}

function ArchiveFileIcon() {
  return (
    <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <rect x="4.75" y="4.5" width="14.5" height="15" rx="2.5" strokeWidth={1.8} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 4.75v4.5h6V4.75" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10 12h4M10 15h4" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 9.25v5.75" />
    </svg>
  )
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

function extractOrderedVariableNames(
  variables: Array<Partial<Variable> | Record<string, unknown>> | undefined
): string[] {
  if (!variables || variables.length === 0) {
    return []
  }

  const names: string[] = []
  const seen = new Set<string>()

  variables.forEach((variable) => {
    const rawName = variable['name']
    const rawSyntaxMode = variable['syntaxMode']
    const name = typeof rawName === 'string' ? rawName.trim() : ''
    const syntaxMode = typeof rawSyntaxMode === 'string' ? rawSyntaxMode : 'variable'
    if (!name || syntaxMode !== 'variable' || seen.has(name)) {
      return
    }
    seen.add(name)
    names.push(name)
  })

  return names
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

  if (job.status === 'cancel_requested' || job.status === 'cancelled') {
    return getProgressPercent(job)
  }

  return 0
}

function getStatusTone(status?: BatchParseJob['status']): { label: string; color: string; bg: string } {
  switch (status) {
    case 'completed':
      return { label: '已完成', color: '#15803d', bg: 'rgba(34, 197, 94, 0.12)' }
    case 'failed':
      return { label: '失败', color: '#b91c1c', bg: 'rgba(239, 68, 68, 0.12)' }
    case 'cancelled':
      return { label: '已取消', color: '#6b7280', bg: 'rgba(107, 114, 128, 0.16)' }
    case 'cancel_requested':
      return { label: '停止中', color: '#b45309', bg: 'rgba(245, 158, 11, 0.16)' }
    case 'parsing':
      return { label: '解析中', color: '#1d4ed8', bg: 'rgba(59, 130, 246, 0.12)' }
    case 'scanning':
      return { label: '扫描中', color: '#7c3aed', bg: 'rgba(124, 58, 237, 0.12)' }
    case 'queued':
      return { label: '排队中', color: '#92400e', bg: 'rgba(245, 158, 11, 0.12)' }
    default:
      return { label: '空闲', color: '#475569', bg: 'rgba(148, 163, 184, 0.12)' }
  }
}

function formatBatchPhaseMessage(message: string): string {
  const phaseMessages: Record<string, string> = {
    'Waiting for background worker': '等待后台任务',
    'Batch job state loaded': '批量任务状态已加载',
    'Stopping batch job': '正在停止批量任务',
    'Batch parse cancelled': '批量解析已取消',
    'Scanning uploads': '正在扫描上传文件',
    'Parsing files': '正在解析文件',
    'Batch parse completed': '批量解析已完成',
    'Batch parse failed': '批量解析失败'
  }

  return phaseMessages[message] || message
}

function ResultStatePill({ success }: { success: boolean }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-full text-xs font-medium flex-shrink-0"
      style={{
        color: success ? '#15803d' : '#b91c1c',
        backgroundColor: success ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)',
        width: success ? '1.25rem' : undefined,
        height: success ? '1.25rem' : undefined,
        padding: success ? '0' : '0.125rem 0.5rem'
      }}
    >
      {success ? (
        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M5 13l4 4L19 7" />
        </svg>
      ) : '失败'}
    </span>
  )
}

function JsonCodeBlock({ value }: { value: unknown }) {
  const jsonText = JSON.stringify(value, null, 2)
  const tokenPattern = /("(?:\\.|[^"\\])*"(?=\s*:))|("(?:\\.|[^"\\])*")|\b(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b|\b(true|false|null)\b/g

  return (
    <pre className="code-block test-results-json-code">
      {jsonText.split('\n').map((line, lineIndex) => {
        const nodes: Array<string | JSX.Element> = []
        let lastIndex = 0

        line.replace(tokenPattern, (match, key, stringValue, numberValue, keywordValue, offset) => {
          if (offset > lastIndex) {
            nodes.push(line.slice(lastIndex, offset))
          }

          const className = key
            ? 'json-token-key'
            : stringValue
              ? 'json-token-string'
              : numberValue
                ? 'json-token-number'
                : keywordValue
                  ? 'json-token-keyword'
                  : ''

          nodes.push(
            <span key={`${lineIndex}-${offset}`} className={className}>
              {match}
            </span>
          )
          lastIndex = offset + match.length
          return match
        })

        if (lastIndex < line.length) {
          nodes.push(line.slice(lastIndex))
        }

        return (
          <span key={lineIndex} className="test-results-json-line">
            {nodes}
            {lineIndex < jsonText.split('\n').length - 1 ? '\n' : null}
          </span>
        )
      })}
    </pre>
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
    variables,
    inputText,
    setInputText,
    addGenerationUploadedFile,
    setActiveTab,
    setBatchUploads
  } = useStore()

  const [uploads, setUploads] = useState<UploadedBatchFile[]>(
    () => useStore.getState().batchUploads  // tab switch: Zustand in-memory
  )
  const [isRestored, setIsRestored] = useState(() => useStore.getState().batchUploads.length > 0)

  // Page refresh: restore from IndexedDB (async, runs once on mount)
  useEffect(() => {
    if (isRestored) return
    void idbGet<UploadedBatchFile[]>(IDB_KEY).then((stored) => {
      if (stored && stored.length > 0) setUploads(stored)
      setIsRestored(true)
    }).catch(() => { setIsRestored(true) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep Zustand + IndexedDB in sync (only after restore to avoid clobbering saved data)
  useEffect(() => {
    if (!isRestored) return
    setBatchUploads(uploads)
    void idbSet(IDB_KEY, uploads).catch(() => { /* ignore */ })
  }, [uploads, isRestored, setBatchUploads])

  const [excludedResultKeys, setExcludedResultKeys] = useState<Set<string>>(new Set())
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>(() => loadStoredSelectedTemplateIds())
  const [isSubmittingBatch, setIsSubmittingBatch] = useState(false)
  const [isCancellingBatch, setIsCancellingBatch] = useState(false)
  const [uploadProgressPercent, setUploadProgressPercent] = useState(0)
  const [batchJob, setBatchJob] = useState<BatchParseJob | null>(null)
  const [batchResultsPage, setBatchResultsPage] = useState<BatchParseResultsPage | null>(null)
  const [batchResultsOffset, setBatchResultsOffset] = useState(0)
  const [batchError, setBatchError] = useState<string | null>(null)
  const [showTemplateSelector, setShowTemplateSelector] = useState(false)
  const [showDownloadMenu, setShowDownloadMenu] = useState(false)
  const [quickParseResults, setQuickParseResults] = useState<QuickParseItem[]>([])
  const [activeResultSource, setActiveResultSource] = useState<ResultViewSource>('batch')
  const [isQuickParsing, setIsQuickParsing] = useState(false)
  const [selectedUploadIds, setSelectedUploadIds] = useState<string[]>([])
  const [previewUploadId, setPreviewUploadId] = useState<string | null>(null)
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
        source: 'saved' as const,
        variableNames: extractOrderedVariableNames(tpl.variables)
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
      name: templateName || '当前模板',
      template: generatedTemplate,
      vendor: '未分配',
      categoryPath: [],
      description: '模板构建中的未保存模板',
      source: 'current',
      variableNames: extractOrderedVariableNames(variables)
    }
  }, [generatedTemplate, savedTemplateOptions, templateName, variables])

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
      template: template.template,
      variableNames: template.variableNames
    }))
  ), [selectedTemplates])

  const restoreJob = useCallback(async (jobId: string) => {
    try {
      const job = await getBatchParseJob(jobId)
      setBatchJob(job)
      setActiveResultSource('batch')
      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        const page = await getBatchParseResultsPage(job.id, 0, RESULTS_PAGE_SIZE)
        setBatchResultsPage(page)
        setBatchResultsOffset(0)
        setExcludedResultKeys(new Set())
      }
      setBatchError(null)
    } catch (error) {
      setStoredJobId(null)
      setBatchError(error instanceof Error ? error.message : '恢复上一次批量任务失败')
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
    if (!batchJob || (batchJob.status !== 'queued' && batchJob.status !== 'scanning' && batchJob.status !== 'parsing' && batchJob.status !== 'cancel_requested')) {
      return
    }

    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const refreshed = await getBatchParseJob(batchJob.id)
          setBatchJob(refreshed)
          if (refreshed.status === 'completed' || refreshed.status === 'failed' || refreshed.status === 'cancelled') {
            const page = await getBatchParseResultsPage(refreshed.id, 0, RESULTS_PAGE_SIZE)
            setBatchResultsPage(page)
            setBatchResultsOffset(0)
          }
        } catch (error) {
          setBatchError(error instanceof Error ? error.message : '刷新批量任务失败')
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

    void Promise.all(acceptedFiles.map(async (file) => {
      const isArchive = getPathExtension(file.name) === '.zip'
      if (isArchive) {
        const blob = new Blob([await file.arrayBuffer()], { type: 'application/zip' })
        return { id: createUploadId(), name: file.name, size: file.size, isArchive, content: '', blob }
      }
      return { id: createUploadId(), name: file.name, size: file.size, isArchive, content: await file.text() }
    })).then((newFiles) => {
      setUploads((current) => [...current, ...newFiles])
    })
  }, [])

  useEffect(() => {
    if (uploads.length === 0) {
      setSelectedUploadIds([])
      setPreviewUploadId(null)
      setUploadPreviewContent('')
      setUploadPreviewError(null)
      return
    }

    const uploadIds = uploads.map((upload) => upload.id)
    setSelectedUploadIds((current) => {
      const kept = current.filter((id) => uploadIds.includes(id))
      return kept.length > 0 ? kept : [uploads[0].id]
    })
    setPreviewUploadId((current) => {
      if (current && uploadIds.includes(current)) {
        return current
      }
      return uploads[0].id
    })
  }, [uploads])

  const selectedUpload = useMemo(
    () => uploads.find((upload) => upload.id === previewUploadId) || null,
    [previewUploadId, uploads]
  )

  useEffect(() => {
    if (!selectedUpload) {
      return
    }

    if (selectedUpload.isArchive) {
      setUploadPreviewContent('')
      setUploadPreviewError('Zip 压缩包会在服务端处理，提交前无法预览。')
      setIsLoadingUploadPreview(false)
      return
    }

    setUploadPreviewError(null)
    setUploadPreviewContent(selectedUpload.content)
    setIsLoadingUploadPreview(false)
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
    setSelectedUploadIds((current) => current.filter((uploadId) => uploadId !== id))
    setUploads((current) => current.filter((upload) => upload.id !== id))
  }

  const handleClearUploads = () => {
    setUploads([])
    setSelectedUploadIds([])
    setPreviewUploadId(null)
    void idbDelete(IDB_KEY).catch(() => { /* ignore */ })
  }

  const handleToggleUploadSelection = (id: string) => {
    setSelectedUploadIds((current) => (
      current.includes(id)
        ? current.filter((uploadId) => uploadId !== id)
        : [...current, id]
    ))
    setPreviewUploadId(id)
  }

  const handleSelectUploadPreview = (id: string) => {
    setPreviewUploadId(id)
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
      setBatchError('请至少选择一个模板。')
      return
    }

    if (uploads.length === 0) {
      setBatchError('请至少上传一个文件或 zip 压缩包。')
      return
    }

    setIsSubmittingBatch(true)
    setUploadProgressPercent(0)
    setBatchError(null)
    setBatchResultsPage(null)
    setBatchResultsOffset(0)
    setQuickParseResults([])
    setActiveResultSource('batch')

    try {
      const job = await createBatchParseJob(batchTemplates, uploads.map((upload) =>
        upload.isArchive && upload.blob
          ? new File([upload.blob], upload.name, { type: 'application/zip' })
          : new File([upload.content], upload.name)
      ), {
        onUploadProgress: (progressPercent) => {
          setUploadProgressPercent(progressPercent)
        }
      })
      setBatchJob(job)
      setStoredJobId(job.id)
    } catch (error) {
      setBatchError(error instanceof Error ? error.message : '启动批量解析任务失败')
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
      setActiveResultSource('batch')
      setBatchError(null)
    } catch (error) {
      setBatchError(error instanceof Error ? error.message : '加载批量解析结果失败')
    }
  }

  const handleCancelBatch = async () => {
    if (!batchJob || batchJob.status === 'cancel_requested') {
      return
    }

    setIsCancellingBatch(true)
    setBatchError(null)

    try {
      const job = await cancelBatchParseJob(batchJob.id)
      setBatchJob(job)
    } catch (error) {
      setBatchError(error instanceof Error ? error.message : '停止批量解析任务失败')
    } finally {
      setIsCancellingBatch(false)
    }
  }

  const handleQuickParse = async () => {
    if (batchTemplates.length === 0) {
      setBatchError('请至少选择一个模板。')
      return
    }

    if (!inputText.trim()) {
      setBatchError('请输入用于快速解析的文本。')
      return
    }

    setIsQuickParsing(true)
    setBatchError(null)
    setQuickParseResults([])

    try {
      const results: QuickParseItem[] = []
      for (const template of batchTemplates) {
        const result = await parseText(inputText, template.template, undefined, template.variableNames)
        results.push({
          templateId: template.id,
          templateName: template.name,
          result
        })
      }
      setQuickParseResults(results)
      setExcludedResultKeys(new Set())
      setActiveResultSource('quick')
    } catch (error) {
      setBatchError(error instanceof Error ? error.message : '快速解析失败')
    } finally {
      setIsQuickParsing(false)
    }
  }

  const statusTone = getStatusTone(batchJob?.status)
  const canCancelBatch = Boolean(
    batchJob &&
    (batchJob.status === 'queued' || batchJob.status === 'scanning' || batchJob.status === 'parsing')
  )
  const activeProgressPercent = getActiveProgressPercent(batchJob, isSubmittingBatch, uploadProgressPercent)
  const showProgressStrip = isSubmittingBatch || Boolean(batchJob)
  const progressTone = isSubmittingBatch
    ? { color: '#1d4ed8', bg: 'rgba(59, 130, 246, 0.16)' }
    : batchJob?.status === 'cancel_requested'
      ? { color: '#b45309', bg: 'rgba(245, 158, 11, 0.16)' }
      : batchJob?.status === 'cancelled'
        ? { color: '#6b7280', bg: 'rgba(107, 114, 128, 0.16)' }
    : batchJob?.status === 'failed'
      ? { color: '#b91c1c', bg: 'rgba(239, 68, 68, 0.16)' }
      : batchJob?.status === 'completed'
        ? { color: '#15803d', bg: 'rgba(34, 197, 94, 0.16)' }
        : batchJob?.status === 'scanning'
          ? { color: '#7c3aed', bg: 'rgba(124, 58, 237, 0.16)' }
          : { color: '#1d4ed8', bg: 'rgba(59, 130, 246, 0.16)' }
  const progressTitle = isSubmittingBatch
    ? `上传文件到后端 · ${uploadProgressPercent}%`
    : batchJob
      ? `${statusTone.label} · ${formatBatchPhaseMessage(batchJob.phaseMessage)}`
      : '空闲'
  const progressDetail = isSubmittingBatch
    ? `准备 ${uploads.length} 个上传文件`
    : batchJob && batchJob.status === 'scanning'
      ? `${batchJob.scannedUploads}/${batchJob.totalUploads} 个上传文件已扫描${
          batchJob.totalArchiveEntries > 0
            ? ` · ${batchJob.processedArchiveEntries}/${batchJob.totalArchiveEntries} 个压缩包条目已检查`
            : ''
        }`
      : batchJob && batchJob.status === 'parsing'
        ? `${batchJob.completedTasks}/${batchJob.totalTasks} 个解析任务完成 · ${batchJob.discoveredFileCount} 个文件`
        : batchJob && batchJob.status === 'cancel_requested'
          ? `${batchJob.completedTasks}/${batchJob.totalTasks} 个解析任务完成 · 等待运行中的任务停止`
          : batchJob && batchJob.status === 'cancelled'
            ? `取消前完成 ${batchJob.completedTasks}/${batchJob.totalTasks} 个解析任务`
        : batchJob && batchJob.status === 'completed'
          ? `${batchJob.completedTasks}/${batchJob.totalTasks} 个解析任务完成 · ${batchJob.successCount} 成功 · ${batchJob.failureCount} 失败`
          : batchJob && batchJob.status === 'failed'
            ? batchJob.recentError?.error ? String(batchJob.recentError.error) : '批量解析失败'
            : batchJob
              ? `${batchJob.uploadCount} 个上传文件排队中`
              : ''
  const rawBatchResults = batchResultsPage?.items || batchJob?.previewResults || []
  const canGoPrev = batchResultsOffset > 0
  const canGoNext = batchResultsPage
    ? batchResultsOffset + batchResultsPage.items.length < batchResultsPage.total
    : false
  const quickItems = useMemo<DisplayResultItem[]>(() => (
    quickParseResults.map((item) => ({
      key: `quick-${item.templateId}`,
      source: 'quick' as const,
      templateName: item.templateName,
      fileName: getQuickParseDisplayName(item.result, inputText),
      success: item.result.success,
      error: item.result.error,
      errorType: item.result.errorType,
      result: item.result.result,
      csvResult: item.result.csvResult,
      checkupCsvResult: item.result.checkupCsvResult
    }))
  ), [inputText, quickParseResults])

  const batchItems = useMemo<DisplayResultItem[]>(() => (
    rawBatchResults.map((item, index) => ({
      key: `batch-${String(item.file_name || item.fileName || index)}`,
      source: 'batch' as const,
      templateName: String(item.template_name || item.templateName || '-'),
      fileName: String(item.file_name || item.fileName || '-'),
      success: typeof item.success === 'boolean'
        ? item.success
        : item.result !== null && item.result !== undefined,
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
  ), [rawBatchResults])

  const displayResults = useMemo<DisplayResultItem[]>(() => {
    const all = (activeResultSource === 'quick' && quickItems.length > 0)
      ? quickItems
      : batchItems.length > 0
        ? batchItems
        : quickItems
    return excludedResultKeys.size > 0 ? all.filter((item) => !excludedResultKeys.has(item.key)) : all
  }, [activeResultSource, batchItems, quickItems, excludedResultKeys])

  useEffect(() => {
    if (displayResults.length === 0) {
      setSelectedResultIndex(0)
      return
    }

    setSelectedResultIndex((current) => Math.min(current, displayResults.length - 1))
  }, [displayResults])

  const currentResult = displayResults[selectedResultIndex] || displayResults[0] || null
  const failedCount = displayResults.filter((item) => !item.success).length
  const hasDownloads = Boolean(
    batchJob?.artifactUrls.summary
    || batchJob?.artifactUrls.results
    || batchJob?.artifactUrls.errors
    || batchJob?.artifactUrls.excel
  )

  const handleSendToConfigGen = () => {
    const eligible = displayResults.filter((item) => item.success && item.result !== undefined)
    if (eligible.length === 0) return

    const byFile: Record<string, { alias: string; result: unknown }[]> = {}
    eligible.forEach((item) => {
      const alias = item.templateName
        .trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'template'
      if (!byFile[item.fileName]) byFile[item.fileName] = []
      byFile[item.fileName].push({ alias, result: item.result })
    })

    Object.entries(byFile).forEach(([fileName, items]) => {
      const payload: Record<string, unknown> = {}
      items.forEach(({ alias, result }) => { payload[alias] = result })
      const jsonStr = JSON.stringify(payload, null, 2)
      const blob = new Blob([jsonStr], { type: 'application/json' })
      const preservedName = getLeafFileName(fileName.trim()) || 'results.json'
      const file = new File([blob], preservedName, { type: 'application/json' })
      addGenerationUploadedFile({
        id: `genfile-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
        file,
        name: preservedName,
        size: blob.size,
        content: jsonStr
      })
    })

    setActiveTab('config')
  }

  return (
    <div className="test-results-page page-root relative">
      <div className="page-toolbar">
        <div className="page-toolbar-left">
          <h2 className="page-title">测试 & 结果</h2>
          <div
            className="toolbar-sep"
            style={{ borderColor: 'var(--border-color)' }}
          />
          <button
            onClick={() => setShowTemplateSelector(true)}
            className="btn"
          >
            模板
          </button>
          <span className="muted truncate">
            {selectedTemplateIds.length}/{(currentTemplateOption ? 1 : 0) + savedTemplateOptions.length} 已选
          </span>
        </div>
        <div className="page-toolbar-actions">
          <button
            onClick={handleQuickParse}
            disabled={isQuickParsing || batchTemplates.length === 0}
            className="btn"
          >
            {isQuickParsing ? '解析中...' : '快速解析'}
          </button>
          <button
            onClick={handleStartBatch}
            disabled={isSubmittingBatch || uploads.length === 0 || batchTemplates.length === 0}
            className="btn"
          >
            {isSubmittingBatch ? '提交中...' : '批量解析'}
          </button>
          <button
            onClick={handleCancelBatch}
            disabled={!canCancelBatch || isCancellingBatch}
            className="btn"
          >
            {isCancellingBatch || batchJob?.status === 'cancel_requested' ? '停止中...' : '停止'}
          </button>
          <button
            onClick={handleSendToConfigGen}
            disabled={displayResults.filter((item) => item.success && item.result !== undefined).length === 0}
            className="btn"
          >
            → 配置生成
          </button>
          {hasDownloads && (
            <div className="relative">
                <button
                  onClick={() => setShowDownloadMenu((current) => !current)}
                  className="btn flex items-center gap-1"
                  aria-label="Download results 下载结果"
                >
                  下载结果
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showDownloadMenu && (
                <div
                  className="download-menu"
                >
                  {batchJob?.artifactUrls.summary && (
                    <a href={batchJob.artifactUrls.summary}>
                      摘要
                    </a>
                  )}
                  {batchJob?.artifactUrls.results && (
                    <a href={batchJob.artifactUrls.results}>
                      结果 JSONL
                    </a>
                  )}
                  {batchJob?.artifactUrls.errors && (
                    <a href={batchJob.artifactUrls.errors}>
                      错误 JSONL
                    </a>
                  )}
                  {batchJob?.artifactUrls.excel && (
                    <a href={batchJob.artifactUrls.excel}>
                      Excel
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
          className="progress-card"
        >
          <div className="progress-head">
            <span
              className="ui-tag"
              style={{ backgroundColor: progressTone.bg, color: progressTone.color }}
            >
              {isSubmittingBatch ? '上传中' : statusTone.label}
            </span>
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <strong className="truncate" style={{ color: 'var(--text-primary)' }}>
                {progressTitle}
              </strong>
              {progressDetail && (
                <>
                  <div
                    className="h-4 border-l border-dashed flex-shrink-0"
                    style={{ borderColor: 'var(--border-color)' }}
                  />
                  <span className="truncate">
                    {progressDetail}
                  </span>
                </>
              )}
            </div>
            <code className="whitespace-nowrap ml-auto">
              {activeProgressPercent}%
            </code>
          </div>
          <div
            className="progress-track"
          >
            <div
              className="progress-fill"
              style={{
                width: `${activeProgressPercent}%`,
                backgroundColor: progressTone.color
              }}
            />
          </div>
        </div>
      )}

      <div
        className="test-results-grid"
        style={{
          gridTemplateColumns: '180px minmax(0, 1fr) minmax(0, 1fr) 180px'
        }}
      >
        <div className="test-results-sidebar panel-border-r">
          <div className="panel-header panel-header-compact">
            <div className="panel-header-copy">
              <span>上传文件</span>
            </div>
            <div className="panel-header-actions">
              <button
                className="btn"
                onClick={handleClearUploads}
                disabled={uploads.length === 0}
              >
                清空
              </button>
            </div>
          </div>
          <div className="test-results-upload-col">
            <div
              {...getRootProps()}
              className="drop-box test-results-drop-box"
              style={{
                borderColor: isDragActive ? '#3b82f6' : 'var(--border-color)',
                backgroundColor: isDragActive ? 'rgba(59, 130, 246, 0.06)' : 'transparent',
                color: isDragActive ? '#3b82f6' : 'var(--text-secondary)'
              }}
            >
              <input {...getInputProps()} />
              <p>{isDragActive ? '松开以上传文件' : '拖拽文件或点击上传'}</p>
              <small>.txt .log .cfg .conf .zip</small>
            </div>
            <div className="test-results-upload-list">
              <div className="test-results-list-head">
                <span style={{ color: 'var(--text-secondary)' }}>文件</span>
                <div className="flex items-center gap-2">
                  {selectedUploadIds.length > 0 && (
                    <span style={{ color: 'var(--text-secondary)' }}>
                      {selectedUploadIds.length} 已选
                    </span>
                  )}
                  <span style={{ color: 'var(--text-muted)' }}>
                    {uploads.length}
                  </span>
                </div>
              </div>
              {uploads.length === 0 ? (
                <p className="mini-empty">
                  暂无文件
                </p>
	              ) : (
	                <div>
                  {uploads.map((upload) => {
                    const isSelected = selectedUploadIds.includes(upload.id)
                    const isPreviewed = previewUploadId === upload.id

                    return (
                      <div
                        key={upload.id}
                        onClick={() => handleSelectUploadPreview(upload.id)}
                        className="test-results-file-row group"
                        style={{
                          backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.12)' : 'transparent',
                          border: isPreviewed ? '1px solid rgba(59, 130, 246, 0.55)' : '1px solid transparent'
                        }}
                        title={upload.name}
                      >
                        <div className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            readOnly
                            onClick={(event) => {
                              event.stopPropagation()
                              handleToggleUploadSelection(upload.id)
                            }}
                            className="mt-1 h-3.5 w-3.5 accent-blue-500"
                            aria-label={`选择 ${upload.name}`}
                          />
                          <span className="mt-0.5" style={{ color: upload.isArchive ? 'var(--accent-primary)' : 'var(--text-muted)' }}>
                            {upload.isArchive ? <ArchiveFileIcon /> : <UploadedFileIcon />}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="test-results-row-title" style={{ color: 'var(--text-primary)' }}>{upload.name}</p>
                            <p className="test-results-row-meta" style={{ color: 'var(--text-muted)' }}>
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
                            title="删除文件"
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

        <div className="test-results-preview-panel panel-border-r">
          <div className="test-results-panel-header">
            <div className="flex items-center gap-3 min-w-0 w-full">
              <h3 style={{ color: 'var(--text-primary)' }}>配置预览</h3>
              <span className="truncate" style={{ color: 'var(--text-secondary)' }}>
                {selectedUpload ? selectedUpload.name : '手动输入'}
              </span>
              {selectedUpload && (
                <span className="whitespace-nowrap ml-auto" style={{ color: 'var(--text-muted)' }}>
                  {formatFileSize(selectedUpload.size)}
                </span>
              )}
            </div>
          </div>
          <div className="test-results-code-pane">
            {selectedUpload ? (
              isLoadingUploadPreview ? (
                <div className="h-full flex items-center justify-center text-center px-6" style={{ color: 'var(--text-muted)' }}>
                  <p className="mini-empty">正在加载预览...</p>
                </div>
              ) : uploadPreviewError ? (
                <div className="h-full flex items-center justify-center text-center px-6" style={{ color: 'var(--text-muted)' }}>
                  <div>
                    <p className="mini-empty">{uploadPreviewError}</p>
                    {selectedUpload.isArchive && (
                      <p className="mini-empty">压缩包内容会在批量任务开始后展开。</p>
                    )}
                  </div>
                </div>
              ) : (
                <pre className="code-block">
                  {uploadPreviewContent}
                </pre>
              )
            ) : (
              <textarea
                value={inputText}
                onChange={(event) => setInputText(event.target.value)}
                placeholder="粘贴样本内容用于快速解析"
                className="preview-textarea"
              />
            )}
          </div>
        </div>

        <div className="test-results-detail-panel panel-border-r">
          <div className="test-results-panel-header">
            <span className="test-results-panel-title" style={{ color: 'var(--text-primary)' }}>解析结果</span>
            {displayResults.length > 0 ? (
              <>
                {failedCount > 0 && (
                  <span className="ui-tag ui-tag-red">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    {failedCount} 失败
                  </span>
                )}
                {batchJob && (
                  <span className="ml-auto truncate" style={{ color: 'var(--text-muted)' }}>
                    {batchJob.completedTasks}/{batchJob.totalTasks} 任务 · {getProgressPercent(batchJob)}%
                  </span>
                )}
              </>
            ) : (
              <span style={{ color: 'var(--text-muted)' }}>暂无结果</span>
            )}
          </div>

          <div className="test-results-detail-body">
            {!displayResults.length ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center" style={{ color: 'var(--text-muted)' }}>
                  <svg className="test-results-empty-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="mini-empty">暂无结果</p>
                  <p className="mini-empty">1. 选择一个或多个模板</p>
                  <p className="mini-empty">2. 上传文件或输入样本文本</p>
                  <p className="mini-empty">3. 点击“批量解析”或“快速解析”</p>
                  {selectedTemplates.length === 0 && (
                    <p className="mini-empty mt-4" style={{ color: 'var(--error)' }}>尚未选择模板</p>
                  )}
                </div>
              </div>
            ) : currentResult?.success ? (
              <div className="test-results-detail-content">
                <div className="test-results-result-status-line is-success">
                  <span
                    className="test-results-result-status-icon"
                    title={currentResult.source === 'batch' ? '解析成功' : '快速解析成功'}
                    aria-label={currentResult.source === 'batch' ? '解析成功' : '快速解析成功'}
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                  <span className="test-results-result-status-title">
                    {currentResult.source === 'batch' ? '解析成功' : '快速解析成功'}
                  </span>
                  <span className="test-results-result-status-meta">
                    {currentResult.templateName} · {getLeafFileName(currentResult.fileName)}
                  </span>
                </div>
                <div className="test-results-json-view">
                  <JsonCodeBlock value={currentResult.result} />
                </div>
              </div>
            ) : (
              <div className="test-results-detail-content">
                <div className="test-results-error-panel">
                  <div className="test-results-result-status-line is-error">
                    <span className="test-results-result-status-icon">
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="10" strokeWidth={2} />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 9L9 15M9 9l6 6" />
                      </svg>
                    </span>
                    <span className="test-results-result-status-title">
                      {currentResult?.source === 'batch' ? '解析失败' : '快速解析失败'}
                    </span>
                    {currentResult && (
                      <span className="test-results-result-status-meta">
                        {currentResult.templateName} · {getLeafFileName(currentResult.fileName)}
                      </span>
                    )}
                  </div>
                  {currentResult?.errorType && (
                    <p className="test-results-error-type">{currentResult.errorType}</p>
                  )}
                  <pre className="code-block test-results-error-code">{currentResult?.error || '未知错误'}</pre>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="test-results-list-panel">
          <div className="panel-header panel-header-compact">
            <div className="panel-header-copy">
              <span>结果列表</span>
              <small>{displayResults.length}</small>
            </div>
          </div>
          <div className="test-results-result-list">
            {displayResults.length === 0 ? (
              <div className="test-results-empty">
                <p className="mini-empty">暂无结果项</p>
              </div>
            ) : (
              <div>
                {displayResults.map((item, index) => (
                  <div
                    key={item.key}
                    onClick={() => setSelectedResultIndex(index)}
                    className="test-results-result-row"
                    style={{
                      backgroundColor: selectedResultIndex === index ? 'var(--accent-subtle)' : 'transparent',
                      border: selectedResultIndex === index ? '1px solid var(--accent)' : '1px solid transparent'
                    }}
                  >
                    <div className="flex items-start gap-2">
                      <div className="mt-0.5">
                        <ResultStatePill success={item.success} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="test-results-row-title">{getLeafFileName(item.fileName)}</p>
                        <p className="test-results-row-meta">{item.templateName}</p>
                        {!item.success && item.error && (
                          <p className="test-results-row-error">{item.error}</p>
                        )}
                      </div>
                      <button
                        className="test-results-remove-button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setExcludedResultKeys((prev) => new Set([...prev, item.key]))
                        }}
                        title="移除此结果"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
                {batchResultsPage && (
                  <div className="pager">
                    <button
                      type="button"
                      onClick={() => handleLoadResultsPage(Math.max(0, batchResultsOffset - RESULTS_PAGE_SIZE))}
                      disabled={!canGoPrev}
                      className="btn"
                    >
                      上一页
                    </button>
                    <span>
                      {batchResultsOffset + 1}-{batchResultsOffset + batchResultsPage.items.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleLoadResultsPage(batchResultsOffset + RESULTS_PAGE_SIZE)}
                      disabled={!canGoNext}
                      className="btn"
                    >
                      下一页
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
            className="modal-backdrop"
            style={{ backgroundColor: 'var(--overlay-backdrop)' }}
          >
            <div
              className="template-selector-modal"
            >
              <div className="template-selector-header">
                <div>
                  <h3>模板选择</h3>
                </div>
                <div className="template-selector-actions">
                  <button onClick={handleSelectAllTemplates} className="btn">全选/反选</button>
                  <button onClick={() => setShowTemplateSelector(false)} className="btn">关闭</button>
                </div>
              </div>

              <TemplateDirectoryTree
                title=""
                vendors={vendors}
                categories={parseCategories}
                templates={currentTemplateOption ? [currentTemplateOption, ...savedTemplateOptions] : savedTemplateOptions}
                loading={isLoadingTemplates || isLoadingTemplateDirectories}
                emptyText="暂无解析模板。"
                selectedTemplateIds={selectedTemplateIds}
                multiSelect
                onTemplateToggle={(templateId) => {
                  setSelectedTemplateIds((current) => (
                    current.includes(templateId)
                      ? current.filter((id) => id !== templateId)
                      : [...current, templateId]
                  ))
                }}
                renderTemplateMeta={(template) => {
                  const metaText = template.source === 'current' ? '未保存' : template.description
                  return metaText ? (
                    <span className="test-results-template-meta">{metaText}</span>
                  ) : null
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
