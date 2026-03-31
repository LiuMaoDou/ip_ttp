import { useMemo } from 'react'

interface BindingSelectorOption {
  id: string
  label: string
  expression: string
  templateName: string
}

interface BindingSelectorModalProps {
  selectedText: string
  options: BindingSelectorOption[]
  onConfirm: (selectorId: string) => void
  onCancel: () => void
}

export default function BindingSelectorModal({ selectedText, options, onConfirm, onCancel }: BindingSelectorModalProps) {
  const groupedOptions = useMemo(() => {
    const groups = new Map<string, BindingSelectorOption[]>()

    options.forEach((option) => {
      const group = groups.get(option.templateName) || []
      group.push(option)
      groups.set(option.templateName, group)
    })

    return Array.from(groups.entries())
  }, [options])

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'var(--overlay-backdrop)' }} onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="rounded-lg p-6 w-[720px] shadow-xl max-h-[80vh] flex flex-col" style={{ backgroundColor: 'var(--bg-secondary)' }}>
        <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
          Bind to Parse Parameter
        </h3>

        <div className="mb-4 p-3 rounded-md" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
          <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Selected Text</label>
          <code className="text-sm whitespace-pre-wrap break-all" style={{ color: '#22c55e' }}>{selectedText}</code>
        </div>

        {options.length === 0 ? (
          <div className="mb-4 p-3 rounded-md border" style={{ borderColor: 'var(--border-color)', color: 'var(--text-muted)' }}>
            No parameters available. Select one or more source parse templates first.
          </div>
        ) : (
          <div className="flex-1 overflow-auto space-y-4 pr-1">
            {groupedOptions.map(([templateName, templateOptions]) => (
              <div key={templateName}>
                <div className="text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                  {templateName}
                </div>
                <div className="space-y-2">
                  {templateOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => onConfirm(option.id)}
                      className="w-full text-left p-3 rounded border transition-colors"
                      style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-tertiary)' }}
                    >
                      <div className="text-sm break-all" style={{ color: 'var(--text-primary)' }}>{option.label}</div>
                      <div className="text-xs break-all mt-1" style={{ color: 'var(--accent-primary)' }}>{option.expression}</div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-3 mt-4">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 border rounded-md transition-colors"
            style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
