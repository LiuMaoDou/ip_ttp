import type { editor } from 'monaco-editor'
import { useMemo, useRef, useState } from 'react'
import { useStore, type Group, type Variable } from '../../store/useStore'
import { CodeEditor, type OnMount } from '../../ui/CodeEditor'
import { Btn, FileIcon, FormField, Input, Modal, PanelHeader, Select, Tag } from '../../ui/primitives'
import {
  createGroupFromSelection,
  createVariableFromSelection,
  downloadText,
  getDefaultPattern,
  getDefaultVariableName,
  templatePath,
  variableColor
} from '../common'

interface CurrentSelection {
  text: string
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
}

export function TemplateBuilderPage() {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const [selection, setSelection] = useState<CurrentSelection | null>(null)
  const [showVariableModal, setShowVariableModal] = useState(false)
  const [showGroupModal, setShowGroupModal] = useState(false)
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftVendor, setDraftVendor] = useState('Unassigned')
  const [draftCategory, setDraftCategory] = useState('')

  const {
    sampleText,
    setSampleText,
    generatedTemplate,
    theme,
    variables,
    groups,
    templateName,
    savedTemplates,
    selectedSavedTemplateId,
    patterns,
    isLoadingTemplates,
    addVariable,
    addGroup,
    removeVariable,
    removeGroup,
    generateTemplate,
    saveTemplate,
    loadTemplate,
    deleteTemplate,
    newTemplate
  } = useStore()

  const selectedTemplate = savedTemplates.find((template) => template.id === selectedSavedTemplateId)
  const sampleLineCount = sampleText ? sampleText.split(/\r?\n/).length : 0
  const generatedLineCount = generatedTemplate ? generatedTemplate.split(/\r?\n/).length : 0
  const hasSelection = Boolean(selection?.text.trim())

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

  const openSave = () => {
    setDraftName(templateName || selectedTemplate?.name || 'Template')
    setDraftVendor(selectedTemplate?.vendor || 'Unassigned')
    setDraftCategory((selectedTemplate?.categoryPath || []).join('/'))
    setShowSaveModal(true)
  }

  const saveCurrentTemplate = async () => {
    await saveTemplate(
      draftName.trim() || 'Template',
      selectedTemplate?.description || '',
      draftVendor.trim() || 'Unassigned',
      draftCategory.split('/').map((segment) => segment.trim()).filter(Boolean),
      'sample'
    )
    setShowSaveModal(false)
  }

  const templateCount = isLoadingTemplates ? '...' : String(savedTemplates.length)

  return (
    <div className="page-root">
      <div className="page-toolbar">
        <div className="page-toolbar-left">
          <span className="page-title">模板构建</span>
          <span className="toolbar-sep" />
          <span className="muted">{selectedTemplate ? templatePath(selectedTemplate) : '当前草稿'}</span>
        </div>
        <div className="page-toolbar-actions">
          <Btn onClick={newTemplate}>新建</Btn>
          <Btn variant="primary" onClick={() => generateTemplate()} disabled={!sampleText.trim()}>生成模板</Btn>
          <Btn onClick={openSave} disabled={!sampleText.trim() && !generatedTemplate.trim()}>保存</Btn>
          <Btn onClick={() => downloadText(`${templateName || 'template'}.ttp`, generatedTemplate)} disabled={!generatedTemplate.trim()}>下载模板</Btn>
        </div>
      </div>

      <div className="page-grid template-builder-layout">
        <aside className="panel panel-border-r">
          <PanelHeader title="模板库" compact subtitle="解析模板" actions={<span className="muted">{templateCount}</span>} />
          <div className="scroll-area item-list">
            {savedTemplates.length === 0 ? (
              <div className="empty-state compact-empty">
                <strong>暂无保存模板</strong>
                <span>构建完成后保存到这里</span>
              </div>
            ) : savedTemplates.map((template) => (
              <div
                key={template.id}
                className={`template-card ${selectedSavedTemplateId === template.id ? 'is-active' : ''}`}
                onClick={() => void loadTemplate(template.id)}
              >
                <div className="template-card-icon"><FileIcon /></div>
                <div className="list-copy">
                  <strong>{template.name}</strong>
                  <span>{templatePath(template)}</span>
                </div>
                <button
                  type="button"
                  className="ui-icon-btn"
                  title="删除"
                  onClick={(event) => {
                    event.stopPropagation()
                    void deleteTemplate(template.id)
                  }}
                >
                  x
                </button>
              </div>
            ))}
          </div>
        </aside>

        <main className="builder-center panel-border-r">
          <section className="panel panel-main builder-editor-panel">
            <PanelHeader
              title="样本文本"
              compact
              subtitle={`${sampleLineCount} 行`}
              actions={<Tag tone={hasSelection ? 'green' : 'default'}>{hasSelection ? '已选择' : '等待选择'}</Tag>}
            />
            <div className="editor-wrap">
              <CodeEditor
                theme={theme}
                language="plaintext"
                value={sampleText}
                onMount={handleMount}
                onChange={(value) => setSampleText(value || '')}
                placeholder="粘贴设备输出或配置样本。拖选需要抽取的文本后，在右侧创建变量或组。"
              />
            </div>
          </section>

          <section className="panel panel-main builder-editor-panel">
            <PanelHeader
              title="生成模板"
              compact
              subtitle={`${templateName || '未命名'} · ${generatedLineCount} 行`}
              actions={<Tag tone="purple">{variables.length} 变量 · {groups.length} 组</Tag>}
            />
            <div className="editor-wrap">
              <CodeEditor
                theme={theme}
                language="xml"
                value={generatedTemplate}
                onChange={(value) => useStore.setState({ generatedTemplate: value || '' })}
                placeholder="生成后的 TTP 模板会显示在这里。也可以手动微调模板内容。"
              />
            </div>
          </section>
        </main>

        <aside className="panel builder-side-panel">
          <PanelHeader title="构建器" compact actions={<span className="muted">{variables.length + groups.length}</span>} />
          <div className="scroll-area builder-inspector">
            <SelectionCard
              selection={selection}
              onAddVariable={() => setShowVariableModal(true)}
              onAddGroup={() => setShowGroupModal(true)}
            />
            <VariableSection variables={variables} onRemove={removeVariable} />
            <GroupSection groups={groups} onRemove={removeGroup} />
          </div>
        </aside>
      </div>

      {showVariableModal && selection && (
        <VariableModal
          selection={selection}
          patterns={patterns}
          onClose={() => setShowVariableModal(false)}
          onSave={(name, pattern, indicators) => {
            addVariable(createVariableFromSelection(selection.text, selection, name, pattern, indicators))
            generateTemplate()
            setShowVariableModal(false)
          }}
        />
      )}

      {showGroupModal && selection && (
        <GroupModal
          selection={selection}
          onClose={() => setShowGroupModal(false)}
          onSave={(name) => {
            addGroup(createGroupFromSelection(selection, name))
            generateTemplate()
            setShowGroupModal(false)
          }}
        />
      )}

      {showSaveModal && (
        <Modal title="保存模板" onClose={() => setShowSaveModal(false)}>
          <FormField label="模板名称"><Input value={draftName} onChange={(event) => setDraftName(event.target.value)} autoFocus /></FormField>
          <FormField label="厂商"><Input value={draftVendor} onChange={(event) => setDraftVendor(event.target.value)} /></FormField>
          <FormField label="分类路径" hint="例如 Routing/BGP"><Input value={draftCategory} onChange={(event) => setDraftCategory(event.target.value)} /></FormField>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Btn onClick={() => setShowSaveModal(false)}>取消</Btn>
            <Btn variant="primary" onClick={() => void saveCurrentTemplate()}>保存</Btn>
          </div>
        </Modal>
      )}
    </div>
  )
}

function SelectionCard({
  selection,
  onAddVariable,
  onAddGroup
}: {
  selection: CurrentSelection | null
  onAddVariable: () => void
  onAddGroup: () => void
}) {
  const hasSelection = Boolean(selection?.text.trim())

  return (
    <section className={`builder-card selection-card ${hasSelection ? 'is-ready' : ''}`}>
      <div className="builder-card-head">
        <strong>当前选择</strong>
        {selection ? <span>{selection.startLine}:{selection.startColumn}</span> : <span>未选择</span>}
      </div>
      <pre className="selection-preview">
        {selection?.text.trim() || '在样本文本中拖选字段、整行或多行区块'}
      </pre>
      <div className="selection-actions">
        <Btn variant="primary" onClick={onAddVariable} disabled={!hasSelection}>添加变量</Btn>
        <Btn onClick={onAddGroup} disabled={!hasSelection}>添加组</Btn>
      </div>
    </section>
  )
}

function VariableSection({ variables, onRemove }: { variables: Variable[]; onRemove: (id: string) => void }) {
  return (
    <section className="builder-card">
      <div className="builder-card-head">
        <strong>变量</strong>
        <span>{variables.length}</span>
      </div>
      {variables.length === 0 && <div className="mini-empty">还没有变量</div>}
      {variables.map((variable) => (
        <div key={variable.id} className="entity-card">
          <span className="entity-color" style={{ background: variableColor(variable.colorIndex) }} />
          <div className="entity-copy">
            <strong>{variable.name}</strong>
            <span>{variable.pattern || 'default'} · L{variable.startLine}:C{variable.startColumn}</span>
          </div>
          <button className="ui-icon-btn" onClick={() => onRemove(variable.id)}>x</button>
        </div>
      ))}
    </section>
  )
}

function GroupSection({ groups, onRemove }: { groups: Group[]; onRemove: (id: string) => void }) {
  return (
    <section className="builder-card">
      <div className="builder-card-head">
        <strong>组</strong>
        <span>{groups.length}</span>
      </div>
      {groups.length === 0 && <div className="mini-empty">还没有组</div>}
      {groups.map((group) => (
        <div key={group.id} className="entity-card">
          <span className="entity-color is-group" style={{ background: variableColor(group.colorIndex) }} />
          <div className="entity-copy">
            <strong>{group.name}</strong>
            <span>L{group.startLine} - L{group.endLine} · {group.endLine - group.startLine + 1} 行</span>
          </div>
          <button className="ui-icon-btn" onClick={() => onRemove(group.id)}>x</button>
        </div>
      ))}
    </section>
  )
}

function VariableModal({
  selection,
  patterns,
  onClose,
  onSave
}: {
  selection: CurrentSelection
  patterns: Record<string, { description: string; regex: string }>
  onClose: () => void
  onSave: (name: string, pattern: string, indicators: string[]) => void
}) {
  const [name, setName] = useState(getDefaultVariableName(selection.text))
  const [pattern, setPattern] = useState(getDefaultPattern(selection.text))
  const [filters, setFilters] = useState('')
  const patternOptions = useMemo(() => Object.keys(patterns).sort(), [patterns])
  const indicators = filters.split('|').map((item) => item.trim()).filter(Boolean)

  return (
    <Modal title="添加变量" subtitle="从样本文本选择值并绑定 TTP 变量模式" width={560} onClose={onClose}>
      <div className="form-field">
        <span>已选文本</span>
        <pre className="code-block modal-code-preview is-green">{selection.text}</pre>
      </div>
      <FormField label="变量名称"><Input value={name} onChange={(event) => setName(event.target.value)} /></FormField>
      <FormField label="匹配模式">
        <Select value={pattern} onChange={(event) => setPattern(event.target.value)}>
          {patternOptions.length === 0 && <option value={pattern}>{pattern}</option>}
          {patternOptions.map((key) => <option key={key} value={key}>{key} - {patterns[key]?.description}</option>)}
        </Select>
      </FormField>
      <FormField label="附加过滤器" hint="用 | 分隔，例如 _exact_ | to_int">
        <Input value={filters} onChange={(event) => setFilters(event.target.value)} placeholder="_exact_ | to_int" />
      </FormField>
      <div className="form-field">
        <span>模板语法</span>
        <pre className="code-block modal-code-preview is-accent">
          {`{{ ${name || 'variable'}${[pattern, ...indicators].filter(Boolean).length ? ` | ${[pattern, ...indicators].filter(Boolean).join(' | ')}` : ''} }}`}
        </pre>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Btn onClick={onClose}>取消</Btn>
        <Btn variant="primary" onClick={() => onSave(name.trim() || 'variable', pattern, indicators)}>添加变量</Btn>
      </div>
    </Modal>
  )
}

function GroupModal({ selection, onClose, onSave }: { selection: CurrentSelection; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState('group')
  return (
    <Modal title="添加组" subtitle="将选中的多行样本包装为 TTP group" width={480} onClose={onClose}>
      <div className="form-field">
        <span>已选文本</span>
        <pre className="code-block modal-code-preview is-orange">{selection.text}</pre>
      </div>
      <FormField label="组名称"><Input value={name} onChange={(event) => setName(event.target.value)} autoFocus /></FormField>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Btn onClick={onClose}>取消</Btn>
        <Btn variant="primary" onClick={() => onSave(name.trim() || 'group')}>添加组</Btn>
      </div>
    </Modal>
  )
}
