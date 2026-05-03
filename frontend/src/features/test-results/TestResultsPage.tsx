import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  cancelBatchParseJob,
  createBatchParseJob,
  getBatchParseJob,
  getBatchParseResultsPage,
  parseText,
  type BatchParseJob,
  type BatchParseResultsPage
} from '../../services/api'
import { useStore, type FileParseResult } from '../../store/useStore'
import { Btn, FileIcon, PanelHeader, ProgressBar, Tag } from '../../ui/primitives'
import { fileSizeLabel, templatePath } from '../common'

const RESULTS_PAGE_SIZE = 50

interface UploadItem {
  id: string
  file: File
  name: string
  size: number
  content: string
}

interface DisplayResult extends FileParseResult {
  key: string
}

export function TestResultsPage() {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const pollRef = useRef<number | null>(null)
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null)
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([])
  const [showTemplateModal, setShowTemplateModal] = useState(false)
  const [batchJob, setBatchJob] = useState<BatchParseJob | null>(null)
  const [batchPage, setBatchPage] = useState<BatchParseResultsPage | null>(null)
  const [batchOffset, setBatchOffset] = useState(0)
  const [batchError, setBatchError] = useState('')
  const [showDownloadMenu, setShowDownloadMenu] = useState(false)

  const {
    sampleText,
    generatedTemplate,
    templateName,
    savedTemplates,
    inputText,
    setInputText,
    fileResults,
    setFileResults,
    selectedResultIndex,
    setSelectedResultIndex,
    setActiveTab
  } = useStore()

  const templateOptions = useMemo(() => {
    const current = generatedTemplate.trim()
      ? [{
        id: 'current',
        name: templateName || '当前模板',
        template: generatedTemplate,
        variableNames: useStore.getState().variables.map((variable) => variable.name),
        meta: 'Unsaved'
      }]
      : []
    return [
      ...current,
      ...savedTemplates.map((template) => ({
        id: template.id,
        name: template.name,
        template: template.generatedTemplate,
        variableNames: (template.variables || []).map((variable) => String(variable.name || '')).filter(Boolean),
        meta: templatePath(template)
      }))
    ]
  }, [generatedTemplate, savedTemplates, templateName])

  useEffect(() => {
    if (selectedTemplateIds.length === 0 && templateOptions.length > 0) {
      setSelectedTemplateIds([templateOptions[0].id])
    }
  }, [selectedTemplateIds.length, templateOptions])

  useEffect(() => () => {
    if (pollRef.current) window.clearInterval(pollRef.current)
  }, [])

  const selectedUpload = uploads.find((upload) => upload.id === selectedUploadId) || null
  const selectedTemplates = templateOptions.filter((template) => selectedTemplateIds.includes(template.id))
  const displayResults = useMemo<DisplayResult[]>(() => {
    const batchItems = (batchPage?.items || []).map((item, index) => ({
      key: `batch-${batchOffset + index}`,
      fileId: String(item.file_id || item.fileName || index),
      fileName: String(item.file_name || item.fileName || 'file'),
      templateId: String(item.template_id || item.templateId || ''),
      templateName: String(item.template_name || item.templateName || 'template'),
      result: item.result,
      success: Boolean(item.success),
      error: typeof item.error === 'string' ? item.error : undefined,
      errorType: typeof item.error_type === 'string' ? item.error_type : undefined
    }))
    return batchItems.length > 0
      ? batchItems
      : fileResults.map((result, index) => ({ ...result, key: `${result.fileId}-${index}` }))
  }, [batchOffset, batchPage, fileResults])
  const currentResult = displayResults[selectedResultIndex] || null
  const successCount = displayResults.filter((result) => result.success).length
  const failCount = displayResults.filter((result) => !result.success).length
  const progress = batchJob && batchJob.totalTasks > 0 ? Math.round((batchJob.completedTasks / batchJob.totalTasks) * 100) : 0
  const hasDownloads = Boolean(batchJob?.artifactUrls.summary || batchJob?.artifactUrls.results || batchJob?.artifactUrls.errors || batchJob?.artifactUrls.excel)

  const onFiles = async (files: FileList | null) => {
    if (!files) return
    const next: UploadItem[] = []
    for (const file of Array.from(files)) {
      const isText = !file.name.toLowerCase().endsWith('.zip')
      next.push({
        id: `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        name: file.name,
        size: file.size,
        content: isText ? await file.text() : ''
      })
    }
    setUploads((current) => [...current, ...next])
    setSelectedUploadId(next[0]?.id || selectedUploadId)
  }

  const handleQuickParse = async () => {
    const text = selectedUpload?.content || inputText || sampleText
    if (!text.trim() || selectedTemplates.length === 0) return
    const results: FileParseResult[] = []
    for (const template of selectedTemplates) {
      const parsed = await parseText(text, template.template, template.name, template.variableNames)
      results.push({
        fileId: selectedUpload?.id || 'inline',
        fileName: selectedUpload?.name || 'Inline input',
        templateId: template.id,
        templateName: template.name,
        result: parsed.result,
        csvResult: parsed.csvResult,
        checkupCsvResult: parsed.checkupCsvResult,
        success: parsed.success,
        error: parsed.error,
        errorType: parsed.errorType
      })
    }
    setBatchJob(null)
    setBatchPage(null)
    setFileResults(results)
  }

  const loadResultsPage = useCallback(async (jobId: string, offset: number) => {
    const page = await getBatchParseResultsPage(jobId, offset, RESULTS_PAGE_SIZE)
    setBatchPage(page)
    setBatchOffset(offset)
    setSelectedResultIndex(0)
  }, [setSelectedResultIndex])

  const startPolling = useCallback((jobId: string) => {
    if (pollRef.current) window.clearInterval(pollRef.current)
    pollRef.current = window.setInterval(() => {
      void (async () => {
        const job = await getBatchParseJob(jobId)
        setBatchJob(job)
        if (['completed', 'failed', 'cancelled'].includes(job.status)) {
          if (pollRef.current) window.clearInterval(pollRef.current)
          pollRef.current = null
          await loadResultsPage(job.id, 0)
        }
      })()
    }, 1500)
  }, [loadResultsPage])

  const handleBatchParse = async () => {
    if (uploads.length === 0 || selectedTemplates.length === 0) return
    setBatchError('')
    try {
      const job = await createBatchParseJob(
        selectedTemplates.map((template) => ({
          id: template.id,
          name: template.name,
          template: template.template,
          variableNames: template.variableNames
        })),
        uploads.map((upload) => upload.file)
      )
      setBatchJob(job)
      setBatchPage(null)
      startPolling(job.id)
    } catch (error) {
      setBatchError(error instanceof Error ? error.message : '批量解析提交失败')
    }
  }

  const cancelBatch = async () => {
    if (!batchJob) return
    const job = await cancelBatchParseJob(batchJob.id)
    setBatchJob(job)
  }

  return (
    <div className="page-root">
      <div className="page-toolbar">
        <div className="page-toolbar-left">
          <span className="page-title">测试 & 结果</span>
          <span className="toolbar-sep" />
          <Btn onClick={() => setShowTemplateModal(true)}>解析模板</Btn>
          <span className="muted">{selectedTemplateIds.length}/{templateOptions.length} 已选</span>
        </div>
        <div className="page-toolbar-actions">
          <Btn onClick={handleQuickParse} disabled={selectedTemplates.length === 0}>快速解析</Btn>
          <Btn onClick={handleBatchParse} disabled={uploads.length === 0 || selectedTemplates.length === 0}>批量解析</Btn>
          <Btn onClick={cancelBatch} disabled={!batchJob || !['queued', 'scanning', 'parsing'].includes(batchJob.status)}>停止批量</Btn>
          <Btn onClick={() => setActiveTab('config')} disabled={displayResults.filter((result) => result.success).length === 0}>配置生成</Btn>
          {hasDownloads && (
            <div style={{ position: 'relative' }}>
              <Btn aria-label="Download" onClick={() => setShowDownloadMenu((open) => !open)}>下载</Btn>
              {showDownloadMenu && (
                <div className="download-menu">
                  {batchJob?.artifactUrls.summary && <a href={batchJob.artifactUrls.summary}>Summary</a>}
                  {batchJob?.artifactUrls.results && <a href={batchJob.artifactUrls.results}>Results JSONL</a>}
                  {batchJob?.artifactUrls.errors && <a href={batchJob.artifactUrls.errors}>Errors JSONL</a>}
                  {batchJob?.artifactUrls.excel && <a href={batchJob.artifactUrls.excel}>Excel</a>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {batchJob && (
        <ProgressBar
          percent={progress}
          label={batchJob.status}
          detail={`${batchJob.completedTasks}/${batchJob.totalTasks} tasks · ${batchJob.successCount} OK · ${batchJob.failureCount} failed`}
          tone={batchJob.status === 'failed' ? 'red' : batchJob.status === 'completed' ? 'green' : 'accent'}
        />
      )}
      {batchError && <div className="error-strip">{batchError}</div>}
      <div className="page-grid" style={{ gridTemplateColumns: '180px minmax(0, 1fr) minmax(0, 1fr) 180px' }}>
        <aside className="panel panel-border-r">
          <PanelHeader title="文件" compact actions={<Btn size="xs" onClick={() => inputRef.current?.click()}>上传</Btn>} />
          <input ref={inputRef} type="file" multiple hidden onChange={(event) => void onFiles(event.target.files)} />
          <div className="drop-box" onClick={() => inputRef.current?.click()}>
            <div>拖拽文件或点击上传</div>
            <small>.txt .log .cfg .zip</small>
          </div>
          <div className="scroll-area item-list">
            {uploads.map((upload) => (
              <div key={upload.id} className={`list-item ${selectedUploadId === upload.id ? 'is-active' : ''}`} onClick={() => setSelectedUploadId(upload.id)}>
                <FileIcon />
                <div className="list-copy"><strong>{upload.name}</strong><span>{fileSizeLabel(upload.size)}</span></div>
              </div>
            ))}
          </div>
        </aside>
        <section className="panel panel-main panel-border-r">
          <PanelHeader title="输入预览" compact subtitle={selectedUpload?.name || 'Inline'} />
          <div className="scroll-area" style={{ padding: 14 }}>
            {selectedUpload ? <pre className="code-block">{selectedUpload.content || 'ZIP 归档将在批量任务中展开'}</pre> : (
              <textarea className="preview-textarea" value={inputText} onChange={(event) => setInputText(event.target.value)} placeholder="粘贴快速解析输入文本" />
            )}
          </div>
        </section>
        <section className="panel panel-main panel-border-r">
          <PanelHeader title="解析结果" compact actions={<><Tag tone="green">{successCount} 成功</Tag><Tag tone={failCount ? 'red' : 'default'}>{failCount} 失败</Tag></>} />
          <div className="scroll-area" style={{ padding: 14 }}>
            {currentResult ? (
              currentResult.success
                ? <pre className="code-block">{JSON.stringify(currentResult.result, null, 2)}</pre>
                : <pre className="code-block" style={{ color: 'var(--red)' }}>{currentResult.errorType ? `${currentResult.errorType}\n` : ''}{currentResult.error || 'Unknown error'}</pre>
            ) : <div className="empty-state">暂无解析结果</div>}
          </div>
        </section>
        <aside className="panel">
          <PanelHeader title="结果列表" compact actions={<span className="muted">{displayResults.length}</span>} />
          <div className="scroll-area item-list">
            {displayResults.map((result, index) => (
              <div key={result.key} className={`list-item ${selectedResultIndex === index ? 'is-active' : ''}`} onClick={() => setSelectedResultIndex(index)}>
                <Tag tone={result.success ? 'green' : 'red'}>{result.success ? 'OK' : 'ERR'}</Tag>
                <div className="list-copy"><strong>{result.fileName}</strong><span>{result.templateName}</span></div>
              </div>
            ))}
          </div>
          {batchPage && (
            <div className="pager">
              <Btn size="xs" disabled={batchOffset === 0} onClick={() => void loadResultsPage(batchPage.jobId, Math.max(0, batchOffset - RESULTS_PAGE_SIZE))}>Prev</Btn>
              <span className="muted">{batchOffset + 1}-{Math.min(batchOffset + RESULTS_PAGE_SIZE, batchPage.total)}</span>
              <Btn size="xs" disabled={batchOffset + RESULTS_PAGE_SIZE >= batchPage.total} onClick={() => void loadResultsPage(batchPage.jobId, batchOffset + RESULTS_PAGE_SIZE)}>Next</Btn>
            </div>
          )}
        </aside>
      </div>
      {showTemplateModal && (
        <TemplatePicker
          templates={templateOptions}
          selectedIds={selectedTemplateIds}
          onChange={setSelectedTemplateIds}
          onClose={() => setShowTemplateModal(false)}
        />
      )}
    </div>
  )
}

function TemplatePicker({
  templates,
  selectedIds,
  onChange,
  onClose
}: {
  templates: Array<{ id: string; name: string; meta: string }>
  selectedIds: string[]
  onChange: (ids: string[]) => void
  onClose: () => void
}) {
  return (
    <div className="ui-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="ui-modal" style={{ width: 520 }}>
        <div className="ui-modal-head"><div><h3>选择解析模板</h3><p>选择一个或多个模板用于解析。</p></div><button className="ui-icon-btn" onClick={onClose}>x</button></div>
        <div className="ui-modal-body">
          <div className="item-list">
            {templates.map((template) => {
              const checked = selectedIds.includes(template.id)
              return (
                <label key={template.id} className={`list-item ${checked ? 'is-active' : ''}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onChange(checked ? selectedIds.filter((id) => id !== template.id) : [...selectedIds, template.id])}
                  />
                  <div className="list-copy"><strong>{template.name}</strong><span>{template.meta}</span></div>
                </label>
              )
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Btn onClick={onClose}>关闭</Btn>
            <Btn variant="primary" onClick={onClose}>确认</Btn>
          </div>
        </div>
      </div>
    </div>
  )
}
