import { useRef, useState, type CSSProperties } from 'react'
import { Variable, Group, getVariableColor } from '../../store/useStore'

interface VariableListProps {
  variables: Variable[]
  groups: Group[]
  onEditVariable: (variable: Variable) => void
  onEditGroup: (group: Group) => void
  onRemoveVariable: (id: string) => void
  onRemoveGroup: (id: string) => void
  onReorderVariable: (fromIndex: number, toIndex: number) => void
}

type EntityStyle = CSSProperties & {
  '--entity-color': string
  '--entity-bg': string
  '--entity-bg-hover': string
}

function getVariableDisplay(variable: Variable): { name: string; descriptor: string } {
  if (variable.syntaxMode === 'ignore') {
    return {
      name: 'ignore',
      descriptor: variable.ignoreValue ? `ignore("${variable.ignoreValue}")` : 'ignore'
    }
  }

  if (variable.syntaxMode === 'headers') {
    return {
      name: 'headers',
      descriptor: variable.headersColumns ? `_headers_ | columns(${variable.headersColumns})` : 'headers'
    }
  }

  if (variable.syntaxMode === 'end') {
    return { name: 'end', descriptor: 'end' }
  }

  return {
    name: variable.name,
    descriptor: variable.pattern || ''
  }
}

export default function VariableList({
  variables,
  groups,
  onEditVariable,
  onEditGroup,
  onRemoveVariable,
  onRemoveGroup,
  onReorderVariable
}: VariableListProps) {
  const dragIndex = useRef<number | null>(null)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  return (
    <div className="variable-list-panel">
      <div className="variable-list-header">
        <span>变量 & 组</span>
        <span>{variables.length}V · {groups.length}G</span>
      </div>

      {variables.length === 0 && groups.length === 0 ? (
        <div className="variable-list-empty">
          <p>暂无变量或组</p>
          <span>在样本输入中选择文本，右键添加</span>
        </div>
      ) : (
        <div className="variable-list-body">
          {groups.length > 0 && (
            <section className="variable-list-section">
              <div className="variable-list-section-title">
                <span>组 ({groups.length})</span>
              </div>

              {groups.map((group, index) => {
                const colorIndex = Number.isInteger(group.colorIndex) ? group.colorIndex : index
                const color = getVariableColor(colorIndex)

                return (
                <div
                  key={group.id}
                  className="variable-list-group-row"
                  style={{
                    '--entity-color': color,
                    '--entity-bg': `${color}1f`,
                    '--entity-bg-hover': `${color}2e`
                  } as EntityStyle}
                >
                  <svg className="variable-list-type-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M9 9h6M9 15h6" />
                  </svg>
                  <div className="variable-list-copy">
                    <span className="variable-list-name">{group.name}</span>
                    <span className="variable-list-meta">
                      {group.endLine - group.startLine + 1}L | {group.startLine}-{group.endLine}
                    </span>
                  </div>
                  <div className="variable-list-actions">
                    <button
                      type="button"
                      onClick={() => onEditGroup(group)}
                      className="variable-list-icon-button"
                      title="编辑组"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveGroup(group.id)}
                      className="variable-list-icon-button"
                      title="删除组"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
                )
              })}
            </section>
          )}

          {variables.length > 0 && (
            <section className="variable-list-section">
              <div className="variable-list-section-title">
                <span>变量 ({variables.length})</span>
              </div>

              {variables.map((variable, index) => {
                const colorIndex = Number.isInteger(variable.colorIndex) ? variable.colorIndex : index
                const color = getVariableColor(colorIndex)
                const { name, descriptor } = getVariableDisplay(variable)

                return (
                  <div key={variable.id} className="variable-list-drag-wrap">
                    {hoverIndex === index && dragIndex.current !== null && dragIndex.current !== index && (
                      <div className="variable-list-drop-line" />
                    )}
                    <div
                      draggable
                      onDragStart={() => { dragIndex.current = index }}
                      onDragOver={(event) => { event.preventDefault(); setHoverIndex(index) }}
                      onDrop={() => {
                        if (dragIndex.current !== null && dragIndex.current !== index) {
                          onReorderVariable(dragIndex.current, index)
                        }
                        dragIndex.current = null
                        setHoverIndex(null)
                      }}
                      onDragEnd={() => { dragIndex.current = null; setHoverIndex(null) }}
                      className="variable-list-variable-row"
                      style={{
                        '--entity-color': color,
                        '--entity-bg': `${color}1a`,
                        '--entity-bg-hover': `${color}29`,
                        opacity: dragIndex.current === index ? 0.4 : 1
                      } as EntityStyle}
                    >
                      <svg className="variable-list-drag-handle" viewBox="0 0 8 12" fill="currentColor">
                        <circle cx="2" cy="2" r="1.2" />
                        <circle cx="6" cy="2" r="1.2" />
                        <circle cx="2" cy="6" r="1.2" />
                        <circle cx="6" cy="6" r="1.2" />
                        <circle cx="2" cy="10" r="1.2" />
                        <circle cx="6" cy="10" r="1.2" />
                      </svg>

                      <div className="variable-list-copy">
                        <span className="variable-list-name">{name}</span>
                        {descriptor && <span className="variable-list-meta">| {descriptor}</span>}
                        {variable.indicators && variable.indicators.length > 0 && (
                          <span className="variable-list-tags">
                            {variable.indicators.map((indicator) => (
                              <code key={indicator}>{indicator}</code>
                            ))}
                          </span>
                        )}
                      </div>

                      <div className="variable-list-actions">
                        <button
                          type="button"
                          onClick={() => onEditVariable(variable)}
                          className="variable-list-icon-button"
                          title="编辑变量"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemoveVariable(variable.id)}
                          className="variable-list-icon-button"
                          title="删除变量"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M18 6L6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </section>
          )}
        </div>
      )}
    </div>
  )
}
