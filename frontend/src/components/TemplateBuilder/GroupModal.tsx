import { useState, useEffect } from 'react'

interface GroupModalProps {
  selectedText: string
  startLine: number
  endLine: number
  onConfirm: (name: string) => void
  onCancel: () => void
}

export default function GroupModal({ selectedText, startLine, endLine, onConfirm, onCancel }: GroupModalProps) {
  const [name, setName] = useState('')

  const lineCount = endLine - startLine + 1

  useEffect(() => {
    // Try to extract a meaningful name from the first line
    const firstLine = selectedText.split('\n')[0]
    const defaultName = firstLine
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .substring(0, 20)
    setName(defaultName || 'group')
  }, [selectedText])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (name.trim()) {
      onConfirm(name.trim())
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="rounded-lg p-6 w-[480px] shadow-xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
        <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Add Group</h3>

        <form onSubmit={handleSubmit}>
          {/* Preview */}
          <div className="mb-4 p-3 rounded-md" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
              Selected Lines ({lineCount} lines: {startLine}-{endLine})
            </label>
            <pre className="text-sm max-h-32 overflow-auto font-mono" style={{ color: '#f97316' }}>
              {selectedText.substring(0, 200)}{selectedText.length > 200 ? '...' : ''}
            </pre>
          </div>

          {/* Group Name */}
          <div className="mb-6">
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Group Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., interfaces, routes, vlans"
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2"
              style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
              autoFocus
            />
          </div>

          {/* Preview template syntax */}
          <div className="mb-6 p-3 rounded-md" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Template Syntax</label>
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
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
            >
              Add Group
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
