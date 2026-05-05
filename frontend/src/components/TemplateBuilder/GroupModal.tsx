import { useState, useEffect } from 'react'

interface GroupModalProps {
  mode?: 'create' | 'edit'
  selectedText: string
  startLine: number
  endLine: number
  sampleText: string
  initialName?: string
  onConfirm: (name: string, range: { startLine: number; endLine: number }) => void
  onCancel: () => void
}

function clampLine(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min
  }

  return Math.min(Math.max(Math.trunc(value), min), max)
}

export default function GroupModal({
  mode = 'create',
  selectedText,
  startLine,
  endLine,
  sampleText,
  initialName,
  onConfirm,
  onCancel
}: GroupModalProps) {
  const [name, setName] = useState('')
  const [draftStartLine, setDraftStartLine] = useState(startLine)
  const [draftEndLine, setDraftEndLine] = useState(endLine)

  const maxLine = Math.max(1, sampleText.split('\n').length)
  const normalizedStartLine = clampLine(draftStartLine, 1, maxLine)
  const normalizedEndLine = clampLine(draftEndLine, normalizedStartLine, maxLine)
  const lineCount = normalizedEndLine - normalizedStartLine + 1
  const previewText = sampleText
    ? sampleText.split('\n').slice(normalizedStartLine - 1, normalizedEndLine).join('\n')
    : selectedText

  useEffect(() => {
    if (initialName) {
      setName(initialName)
      return
    }

    // Try to extract a meaningful name from the first line
    const firstLine = selectedText.split('\n')[0]
    const defaultName = firstLine
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .substring(0, 20)
    setName(defaultName || 'group')
  }, [initialName, selectedText])

  useEffect(() => {
    setDraftStartLine(startLine)
    setDraftEndLine(endLine)
  }, [startLine, endLine])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (name.trim()) {
      onConfirm(name.trim(), {
        startLine: normalizedStartLine,
        endLine: normalizedEndLine
      })
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'var(--overlay-backdrop)' }}>
      <div className="template-entity-modal rounded-lg p-6 w-[480px] shadow-xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
        <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
          {mode === 'edit' ? '编辑组' : '添加组'}
        </h3>

        <form onSubmit={handleSubmit}>
          {/* Preview */}
          <div className="mb-4 p-3 rounded-md" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
              已选行（{lineCount} 行：{normalizedStartLine}-{normalizedEndLine}）
            </label>
            <pre className="text-sm max-h-32 overflow-auto font-mono" style={{ color: '#f97316' }}>
              {previewText.substring(0, 200)}{previewText.length > 200 ? '...' : ''}
            </pre>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>组名</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如 interfaces、routes、vlans"
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2"
              style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
              autoFocus
            />
          </div>

          <div className="mb-6 grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>起始行</label>
              <input
                type="number"
                min={1}
                max={maxLine}
                value={draftStartLine}
                onChange={(e) => setDraftStartLine(Number(e.target.value))}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2"
                style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>结束行</label>
              <input
                type="number"
                min={normalizedStartLine}
                max={maxLine}
                value={draftEndLine}
                onChange={(e) => setDraftEndLine(Number(e.target.value))}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2"
                style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
              />
            </div>
          </div>

          {/* Preview template syntax */}
          <div className="mb-6 p-3 rounded-md" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>模板语法</label>
            <code className="text-sm block" style={{ color: '#f97316' }}>
              {'<group name="'}{name}{'">'}
            </code>
            <code className="text-sm block pl-2" style={{ color: 'var(--text-muted)' }}>
              ...
            </code>
            <code className="text-sm block" style={{ color: '#f97316' }}>
              {'</group>'}
            </code>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="btn"
            >
              取消
            </button>
            <button
              type="submit"
              className="btn btn-primary"
            >
              {mode === 'edit' ? '保存' : '添加组'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
