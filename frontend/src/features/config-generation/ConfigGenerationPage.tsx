import type { editor } from 'monaco-editor'
import { useMemo, useRef, useState } from 'react'
import { useStore, buildGenerationSourceTemplates, type GenerationBinding, type SavedTemplate } from '../../store/useStore'
import { CodeEditor, type OnMount } from '../../ui/CodeEditor'
import { Btn, FileIcon, FormField, Input, Modal, PanelHeader, Tag } from '../../ui/primitives'
import { downloadText, fileSizeLabel, templatePath } from '../common'

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
  templateName: string
  templateId: string
  templateAlias: string
  groupPath: string[]
  variableName: string
}

export function ConfigGenerationPage() {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const [selection, setSelection] = useState<CurrentSelection | null>(null)
  const [showSourceModal, setShowSourceModal] = useState(false)
  const [showBindingModal, setShowBindingModal] = useState(false)
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveVendor, setSaveVendor] = useState('Unassigned')
  const [saveCategory, setSaveCategory] = useState('')

  const {
    savedTemplates,
    generationTemplates,
    selectedGenerationTemplateId,
    generationTemplateText,
    setGenerationTemplateText,
    theme,
    generationBindings,
    setGenerationBindings,
    selectedGenerationSourceTemplateIds,
    setSelectedGenerationSourceTemplateIds,
    generationUploadedFiles,
    addGenerationUploadedFile,
    removeGenerationUploadedFile,
    clearGenerationUploadedFiles,
    selectedGenerationFileId,
    setSelectedGenerationFileId,
    generationResults,
    selectedGenerationResultIndex,
    setSelectedGenerationResultIndex,
    isGeneratingConfig,
    saveGenerationTemplate,
    loadGenerationTemplate,
    deleteGenerationTemplate,
    runGeneration
  } = useStore()

  const sourceTemplates = useMemo(
    () => buildGenerationSourceTemplates(savedTemplates, selectedGenerationSourceTemplateIds),
    [savedTemplates, selectedGenerationSourceTemplateIds]
  )

  const selectedGenerationTemplate = generationTemplates.find((template) => template.id === selectedGenerationTemplateId)
  const selectedFile = generationUploadedFiles.find((file) => file.id === selectedGenerationFileId) || generationUploadedFiles[0] || null
  const selectedResult = generationResults[selectedGenerationResultIndex] || null
  const successCount = generationResults.filter((result) => result.success).length

  const bindableSelectors = useMemo<BindableSelector[]>(() => {
    return sourceTemplates.flatMap((sourceTemplate) => {
      const saved = savedTemplates.find((template) => template.id === sourceTemplate.templateId)
      if (!saved) return []
      return (saved.variables || []).map((raw) => {
        const variableName = String(raw.name || '')
        const expression = [sourceTemplate.templateAlias, variableName].filter(Boolean).join('.')
        return {
          id: `${sourceTemplate.templateId}:${variableName}`,
          label: variableName,
          expression,
          templateName: saved.name,
          templateId: sourceTemplate.templateId,
          templateAlias: sourceTemplate.templateAlias,
          groupPath: [],
          variableName
        }
      }).filter((selector) => selector.variableName)
    })
  }, [savedTemplates, sourceTemplates])

  const handleMount: OnMount = (editorInstance) => {
    editorRef.current = editorInstance
    editorInstance.onDidChangeCursorSelection(() => {
      const sel = editorInstance.getSelection()
      const model = editorInstance.getModel()
      if (!sel || !model || sel.isEmpty()) {
        setSelection(null)
        return
      }
      setSelection({
        text: model.getValueInRange(sel),
        startLine: sel.startLineNumber,
        startColumn: sel.startColumn,
        endLine: sel.endLineNumber,
        endColumn: sel.endColumn
      })
    })
  }

  const addBinding = (selector: BindableSelector) => {
    if (!selection || !editorRef.current) return
    const binding: GenerationBinding = {
      id: `binding-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      startLine: selection.startLine,
      startColumn: selection.startColumn,
      endLine: selection.endLine,
      endColumn: selection.endColumn,
      originalText: selection.text,
      reference: {
        templateId: selector.templateId,
        templateName: selector.templateName,
        templateAlias: selector.templateAlias,
        groupPath: selector.groupPath,
        variableName: selector.variableName,
        selector: selector.id,
        expression: selector.expression
      }
    }
    editorRef.current.executeEdits('binding', [{
      range: {
        startLineNumber: selection.startLine,
        startColumn: selection.startColumn,
        endLineNumber: selection.endLine,
        endColumn: selection.endColumn
      },
      text: `{{ ${selector.expression} }}`
    }])
    setGenerationBindings((current) => [...current, binding])
    setShowBindingModal(false)
  }

  const handleFiles = async (files: FileList | null) => {
    if (!files) return
    for (const file of Array.from(files)) {
      addGenerationUploadedFile({
        id: `gen-file-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        name: file.name,
        size: file.size,
        content: await file.text()
      })
    }
  }

  const openSave = () => {
    setSaveName(selectedGenerationTemplate?.name || 'Generation Template')
    setSaveVendor(selectedGenerationTemplate?.vendor || 'Unassigned')
    setSaveCategory((selectedGenerationTemplate?.categoryPath || []).join('/'))
    setShowSaveModal(true)
  }

  const saveTemplate = async () => {
    await saveGenerationTemplate(
      saveName.trim() || 'Generation Template',
      selectedGenerationTemplate?.description || '',
      saveVendor.trim() || 'Unassigned',
      saveCategory.split('/').map((segment) => segment.trim()).filter(Boolean),
      sourceTemplates
    )
    setShowSaveModal(false)
  }

  const preview = applyBindings(generationTemplateText, generationBindings)

  return (
    <div className="page-root">
      <div className="page-toolbar">
        <div className="page-toolbar-left">
          <span className="page-title">配置生成</span>
          <span className="toolbar-sep" />
          <Btn onClick={() => setShowSourceModal(true)}>解析模板</Btn>
          <span className="muted">{selectedGenerationSourceTemplateIds.length}/{savedTemplates.length} 已选</span>
        </div>
        <div className="page-toolbar-actions">
          <Btn onClick={openSave} disabled={!generationTemplateText.trim()}>保存</Btn>
          <Btn onClick={() => setGenerationTemplateText('')}>新建</Btn>
          <Btn onClick={() => downloadText(`${selectedGenerationTemplate?.name || 'generation-template'}.j2`, generationTemplateText)} disabled={!generationTemplateText.trim()}>下载模板</Btn>
          <Btn variant="primary" onClick={() => void runGeneration()} disabled={isGeneratingConfig || !generationTemplateText.trim() || generationUploadedFiles.length === 0}>
            {isGeneratingConfig ? '生成中...' : '生成'}
          </Btn>
        </div>
      </div>

      <div className="page-grid" style={{ gridTemplateColumns: '180px minmax(0, 1fr) 220px' }}>
        <aside className="panel panel-border-r">
          <PanelHeader title="生成模板库" compact actions={<span className="muted">{generationTemplates.length}</span>} />
          <div className="scroll-area item-list">
            {generationTemplates.map((template) => (
              <div key={template.id} className={`template-card ${selectedGenerationTemplateId === template.id ? 'is-active' : ''}`} onClick={() => void loadGenerationTemplate(template.id)}>
                <div className="template-card-icon"><FileIcon /></div>
                <div className="list-copy"><strong>{template.name}</strong><span>{[template.vendor, ...(template.categoryPath || [])].join(' / ')}</span></div>
                <button className="ui-icon-btn" onClick={(event) => { event.stopPropagation(); void deleteGenerationTemplate(template.id) }}>x</button>
              </div>
            ))}
          </div>
        </aside>

        <section className="panel panel-main panel-border-r">
          <div className="page-grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
            <section className="panel panel-main panel-border-r">
              <PanelHeader
                title="Jinja2 模板"
                compact
                subtitle="选择文本后绑定解析参数"
                actions={<Btn size="xs" onClick={() => setShowBindingModal(true)} disabled={!selection || bindableSelectors.length === 0}>绑定 {generationBindings.length}</Btn>}
              />
              <div className="editor-wrap">
                <CodeEditor
                  theme={theme}
                  language="plaintext"
                  value={generationTemplateText}
                  onMount={handleMount}
                  onChange={(value) => setGenerationTemplateText(value || '')}
                  wordWrap="off"
                  placeholder="编写 Jinja2 配置模板。选中文本后点击“绑定”。"
                />
              </div>
            </section>
            <section className="panel panel-main">
              <PanelHeader title="渲染预览" compact />
              <div className="editor-wrap">
                <CodeEditor
                  theme={theme}
                  language="plaintext"
                  value={preview || 'No template content'}
                  readOnly
                  wordWrap="off"
                />
              </div>
            </section>
          </div>
        </section>

        <aside className="panel">
          <PanelHeader title="输入文件 (JSON)" compact actions={<><Btn size="xs" onClick={() => inputRef.current?.click()}>上传</Btn><Btn size="xs" onClick={clearGenerationUploadedFiles}>清空</Btn></>} />
          <input ref={inputRef} type="file" accept=".json" multiple hidden onChange={(event) => void handleFiles(event.target.files)} />
          <div className="drop-box" onClick={() => inputRef.current?.click()}>拖拽 JSON 文件或点击</div>
          <div className="item-list" style={{ maxHeight: 130, overflow: 'auto', borderBottom: '1px solid var(--border)' }}>
            {generationUploadedFiles.map((file) => (
              <div key={file.id} className={`list-item ${selectedFile?.id === file.id ? 'is-active' : ''}`} onClick={() => setSelectedGenerationFileId(file.id)}>
                <FileIcon />
                <div className="list-copy"><strong>{file.name}</strong><span>{fileSizeLabel(file.size)}</span></div>
                <button className="ui-icon-btn" onClick={(event) => { event.stopPropagation(); removeGenerationUploadedFile(file.id) }}>x</button>
              </div>
            ))}
          </div>
          <PanelHeader title="生成结果" compact actions={<Tag tone="green">{successCount} 成功</Tag>} />
          <div className="scroll-area item-list">
            {generationResults.map((result, index) => (
              <div key={`${result.fileName}-${index}`} className={`list-item ${selectedGenerationResultIndex === index ? 'is-active' : ''}`} onClick={() => setSelectedGenerationResultIndex(index)}>
                <Tag tone={result.success ? 'green' : 'red'}>{result.success ? 'OK' : 'ERR'}</Tag>
                <div className="list-copy"><strong>{result.fileName}</strong><span>{result.error || 'generated'}</span></div>
                {result.success && result.generatedText && (
                  <button className="ui-icon-btn" onClick={(event) => { event.stopPropagation(); downloadText(result.fileName, result.generatedText || '') }}>↓</button>
                )}
              </div>
            ))}
          </div>
          <div style={{ borderTop: '1px solid var(--border)', padding: 10 }}>
            <pre className="code-block">{selectedResult?.success ? selectedResult.generatedText : selectedResult?.error || selectedFile?.content || '暂无文件或结果'}</pre>
          </div>
        </aside>
      </div>

      {showSourceModal && (
        <SourceTemplateModal
          templates={savedTemplates}
          selectedIds={selectedGenerationSourceTemplateIds}
          onChange={setSelectedGenerationSourceTemplateIds}
          onClose={() => setShowSourceModal(false)}
        />
      )}
      {showBindingModal && (
        <BindingModal selectors={bindableSelectors} onClose={() => setShowBindingModal(false)} onSelect={addBinding} />
      )}
      {showSaveModal && (
        <Modal title="保存生成模板" onClose={() => setShowSaveModal(false)}>
          <FormField label="模板名称"><Input value={saveName} onChange={(event) => setSaveName(event.target.value)} autoFocus /></FormField>
          <FormField label="厂商"><Input value={saveVendor} onChange={(event) => setSaveVendor(event.target.value)} /></FormField>
          <FormField label="分类路径"><Input value={saveCategory} onChange={(event) => setSaveCategory(event.target.value)} placeholder="Base/BGP" /></FormField>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Btn onClick={() => setShowSaveModal(false)}>取消</Btn>
            <Btn variant="primary" onClick={() => void saveTemplate()}>保存</Btn>
          </div>
        </Modal>
      )}
    </div>
  )
}

function SourceTemplateModal({
  templates,
  selectedIds,
  onChange,
  onClose
}: {
  templates: SavedTemplate[]
  selectedIds: string[]
  onChange: (ids: string[] | ((current: string[]) => string[])) => void
  onClose: () => void
}) {
  return (
    <Modal title="选择解析模板" subtitle="绑定一个或多个解析模板的输出作为变量来源" width={520} onClose={onClose}>
      <div className="item-list">
        {templates.map((template) => {
          const checked = selectedIds.includes(template.id)
          return (
            <label key={template.id} className={`list-item ${checked ? 'is-active' : ''}`}>
              <input type="checkbox" checked={checked} onChange={() => onChange((current) => checked ? current.filter((id) => id !== template.id) : [...current, template.id])} />
              <div className="list-copy"><strong>{template.name}</strong><span>{templatePath(template)}</span></div>
            </label>
          )
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Btn onClick={onClose}>关闭</Btn>
        <Btn variant="primary" onClick={onClose}>确认</Btn>
      </div>
    </Modal>
  )
}

function BindingModal({ selectors, onClose, onSelect }: { selectors: BindableSelector[]; onClose: () => void; onSelect: (selector: BindableSelector) => void }) {
  return (
    <Modal title="变量绑定" subtitle="选择一个解析参数替换当前选中文本" width={520} onClose={onClose}>
      <div className="item-list">
        {selectors.map((selector) => (
          <div key={selector.id} className="list-item" onClick={() => onSelect(selector)}>
            <Tag tone="purple">{selector.templateAlias}</Tag>
            <div className="list-copy"><strong>{selector.label}</strong><span>{selector.expression}</span></div>
          </div>
        ))}
      </div>
    </Modal>
  )
}

function applyBindings(text: string, bindings: GenerationBinding[]) {
  let next = text
  bindings.forEach((binding) => {
    if (binding.originalText && binding.reference.expression) {
      next = next.replace(binding.originalText, `{{ ${binding.reference.expression} }}`)
    }
  })
  return next
}
