import { useState, useEffect } from 'react'

interface GroupModalProps {
  mode?: 'create' | 'edit'
  selectedText: string
  startLine: number
  endLine: number
  initialName?: string
  onConfirm: (name: string) => void
  onCancel: () => void
}

export default function GroupModal({
  mode = 'create',
  selectedText,
  startLine,
  endLine,
  initialName,
  onConfirm,
  onCancel
}: GroupModalProps) {
  const [name, setName] = useState('')

  const lineCount = endLine - startLine + 1

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (name.trim()) {
      onConfirm(name.trim())
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
              已选行（{lineCount} 行：{startLine}-{endLine}）
            </label>
            <pre className="text-sm max-h-32 overflow-auto font-mono" style={{ color: '#f97316' }}>
              {selectedText.substring(0, 200)}{selectedText.length > 200 ? '...' : ''}
            </pre>
          </div>

          <div className="mb-6">
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
