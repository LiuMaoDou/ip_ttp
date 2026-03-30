import { useRef, useState } from 'react'
import { Variable, Group, getVariableColor } from '../../store/useStore'

// Group color (orange)
const GROUP_COLOR = '#f97316'

interface VariableListProps {
  variables: Variable[]
  groups: Group[]
  onEditVariable: (variable: Variable) => void
  onRemoveVariable: (id: string) => void
  onRemoveGroup: (id: string) => void
  onReorderVariable: (fromIndex: number, toIndex: number) => void
}

export default function VariableList({ variables, groups, onEditVariable, onRemoveVariable, onRemoveGroup, onReorderVariable }: VariableListProps) {
  const dragIndex = useRef<number | null>(null)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  if (variables.length === 0 && groups.length === 0) {
    return (
      <div className="p-4 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
        <p>No variables or groups defined</p>
        <p className="mt-2 text-xs">Select text in the editor and right-click to add</p>
      </div>
    )
  }

  return (
    <div className="p-2">
      {/* Groups section */}
      {groups.length > 0 && (
        <div className="mb-3">
          <h3 className="text-sm font-medium mb-2 px-2" style={{ color: 'var(--text-secondary)' }}>Groups ({groups.length})</h3>
          <div className="space-y-2">
            {groups.map((group) => (
              <div
                key={group.id}
                className="p-2 rounded-md border-l-4 group"
                style={{
                  borderColor: GROUP_COLOR,
                  backgroundColor: GROUP_COLOR + '15'
                }}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-xs px-1.5 py-0.5 rounded font-medium text-white"
                        style={{ backgroundColor: GROUP_COLOR }}
                      >
                        {group.name}
                      </span>
                      <span className="text-xs font-mono" style={{ color: GROUP_COLOR }}>
                        &lt;group&gt;
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => onRemoveGroup(group.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity ml-2"
                    style={{ color: 'var(--text-muted)' }}
                    title="Remove group"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Variables section */}
      {variables.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2 px-2" style={{ color: 'var(--text-secondary)' }}>Variables ({variables.length})</h3>
          <div className="space-y-1">
            {variables.map((variable, index) => (
              <div key={variable.id}>
                {hoverIndex === index && dragIndex.current !== null && dragIndex.current !== index && dragIndex.current !== index - 1 && (
                  <div className="h-0.5 rounded mx-2 mb-1" style={{ backgroundColor: 'var(--accent-primary)' }} />
                )}
                <div
                  draggable
                  onDragStart={() => { dragIndex.current = index }}
                  onDragOver={(e) => { e.preventDefault(); setHoverIndex(index) }}
                  onDrop={() => {
                    if (dragIndex.current !== null && dragIndex.current !== index) {
                      onReorderVariable(dragIndex.current, index)
                    }
                    dragIndex.current = null
                    setHoverIndex(null)
                  }}
                  onDragEnd={() => { dragIndex.current = null; setHoverIndex(null) }}
                  className="p-2 rounded-md border-l-4 group flex items-start gap-1"
                  style={{
                    borderColor: getVariableColor(variable.colorIndex),
                    backgroundColor: getVariableColor(variable.colorIndex) + '15',
                    opacity: dragIndex.current === index ? 0.4 : 1,
                    cursor: 'grab'
                  }}
                >
                  {/* Drag handle */}
                  <div
                    className="flex-shrink-0 mt-0.5 opacity-30 hover:opacity-70 transition-opacity"
                    style={{ color: 'var(--text-muted)', cursor: 'grab' }}
                  >
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 16 16">
                      <circle cx="5" cy="4" r="1.2" />
                      <circle cx="11" cy="4" r="1.2" />
                      <circle cx="5" cy="8" r="1.2" />
                      <circle cx="11" cy="8" r="1.2" />
                      <circle cx="5" cy="12" r="1.2" />
                      <circle cx="11" cy="12" r="1.2" />
                    </svg>
                  </div>

                  <div className="flex items-start justify-between gap-2 flex-1 min-w-0">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="text-xs px-1.5 py-0.5 rounded font-medium text-white"
                          style={{ backgroundColor: getVariableColor(variable.colorIndex) }}
                        >
                          {variable.syntaxMode === 'ignore' ? 'ignore' : variable.syntaxMode === 'headers' ? 'headers' : variable.syntaxMode === 'end' ? 'end' : variable.name}
                        </span>
                        {variable.syntaxMode && variable.syntaxMode !== 'variable' ? (
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            {variable.syntaxMode === 'ignore' && variable.ignoreValue
                              ? `ignore("${variable.ignoreValue}")`
                              : variable.syntaxMode === 'headers' && variable.headersColumns
                                ? `_headers_ | columns(${variable.headersColumns})`
                                : variable.syntaxMode}
                          </span>
                        ) : variable.pattern ? (
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>| {variable.pattern}</span>
                        ) : null}
                        {variable.indicators?.map((indicator) => (
                          <span
                            key={indicator}
                            className="text-xs px-1.5 py-0.5 rounded font-mono"
                            style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--accent-primary)' }}
                          >
                            {indicator}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
                      <button
                        onClick={() => onEditVariable(variable)}
                        style={{ color: 'var(--text-muted)' }}
                        title="Edit variable"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M9 11l6.232-6.232a2.5 2.5 0 013.536 3.536L12.536 14.536A2 2 0 0111.12 15.12L8 16l.88-3.12A2 2 0 019.464 11.536z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => onRemoveVariable(variable.id)}
                        style={{ color: 'var(--text-muted)' }}
                        title="Remove variable"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
