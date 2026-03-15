import { Variable, Group, getVariableColor } from '../../store/useStore'

// Group color (orange)
const GROUP_COLOR = '#f97316'

interface VariableListProps {
  variables: Variable[]
  groups: Group[]
  onRemoveVariable: (id: string) => void
  onRemoveGroup: (id: string) => void
}

export default function VariableList({ variables, groups, onRemoveVariable, onRemoveGroup }: VariableListProps) {
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
                    <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                      Lines {group.startLine} - {group.endLine}
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
          <div className="space-y-2">
            {variables.map((variable) => (
              <div
                key={variable.id}
                className="p-2 rounded-md border-l-4 group"
                style={{
                  borderColor: getVariableColor(variable.colorIndex),
                  backgroundColor: getVariableColor(variable.colorIndex) + '15'
                }}
              >
                <div className="flex items-start justify-between">
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
                    <div className="text-xs mt-1 truncate" style={{ color: 'var(--text-muted)' }} title={variable.originalText}>
                      "{variable.originalText}"
                    </div>
                    <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                      Line {variable.startLine}, Col {variable.startColumn}
                    </div>
                  </div>
                  <button
                    onClick={() => onRemoveVariable(variable.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity ml-2"
                    style={{ color: 'var(--text-muted)' }}
                    title="Remove variable"
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
    </div>
  )
}
