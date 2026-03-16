import { useMemo, useState, useEffect } from 'react'
import type { Pattern, Variable, VariableSyntaxMode } from '../../store/useStore'

interface VariableModalProps {
  mode: 'create' | 'edit'
  selectedText: string
  patterns: Record<string, Pattern>
  initialVariable?: Variable | null
  onConfirm: (
    name: string,
    pattern: string,
    indicators: string[],
    syntaxMode: VariableSyntaxMode,
    options?: { ignoreValue?: string; headersColumns?: number | null }
  ) => void
  onCancel: () => void
}

const AVAILABLE_INDICATORS = [
  {
    value: '_exact_',
    label: '_exact_',
    description: 'Keep digits literal on this line.'
  },
  {
    value: '_exact_space_',
    label: '_exact_space_',
    description: 'Keep spaces literal on this line.'
  },
  {
    value: '_line_',
    label: '_line_',
    description: 'Match the selection as any line.'
  },
  {
    value: '_start_',
    label: '_start_',
    description: 'Mark this variable as a group start trigger.'
  }
] as const

const SYNTAX_MODE_OPTIONS: { value: VariableSyntaxMode; label: string; description: string }[] = [
  {
    value: 'variable',
    label: 'Variable',
    description: 'Standard variable with pattern and indicators.'
  },
  {
    value: 'ignore',
    label: 'Ignore',
    description: 'Emit {{ ignore }} or {{ ignore("...") }} for this selection.'
  },
  {
    value: 'headers',
    label: 'Headers',
    description: 'Append {{ _headers_ }} and optional columns(n) after the selected header text.'
  },
  {
    value: 'end',
    label: 'End Marker',
    description: 'Append {{ _end_ }} after the selected text.'
  }
]

function getDefaultVariableName(selectedText: string) {
  const defaultName = selectedText
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 20)

  return defaultName || 'variable'
}

function getDefaultPattern(selectedText: string) {
  const trimmedText = selectedText.trim()

  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(trimmedText)) {
    return 'IP'
  }

  if (/^\d+$/.test(trimmedText)) {
    return 'DIGIT'
  }

  if (/^[0-9a-fA-F]{2}([:-])[0-9a-fA-F]{2}(\1[0-9a-fA-F]{2}){4}$/.test(trimmedText)) {
    return 'MAC'
  }

  if (/^\S+$/.test(trimmedText)) {
    return 'WORD'
  }

  return 'ORPHRASE'
}

export default function VariableModal({ mode, selectedText, patterns, initialVariable, onConfirm, onCancel }: VariableModalProps) {
  const [name, setName] = useState('')
  const [pattern, setPattern] = useState('')
  const [indicators, setIndicators] = useState<string[]>([])
  const [syntaxMode, setSyntaxMode] = useState<VariableSyntaxMode>('variable')
  const [ignoreValue, setIgnoreValue] = useState('')
  const [headersColumns, setHeadersColumns] = useState('')
  const [isIndicatorMenuOpen, setIsIndicatorMenuOpen] = useState(false)

  useEffect(() => {
    const isEditMode = mode === 'edit'

    setName(isEditMode ? (initialVariable?.name || 'variable') : getDefaultVariableName(selectedText))
    setPattern(isEditMode ? (initialVariable?.pattern || '') : getDefaultPattern(selectedText))
    setIndicators(isEditMode ? (initialVariable?.indicators || []) : [])
    setSyntaxMode(isEditMode ? (initialVariable?.syntaxMode || 'variable') : 'variable')
    setIgnoreValue(isEditMode ? (initialVariable?.ignoreValue || '') : '')
    setHeadersColumns(
      isEditMode && initialVariable?.headersColumns != null
        ? String(initialVariable.headersColumns)
        : ''
    )
    setIsIndicatorMenuOpen(false)
  }, [mode, selectedText, initialVariable])

  useEffect(() => {
    if (syntaxMode !== 'variable') {
      setIsIndicatorMenuOpen(false)
    }
  }, [syntaxMode])

  const toggleIndicator = (value: string) => {
    setIndicators((prev) => (
      prev.includes(value)
        ? prev.filter((indicator) => indicator !== value)
        : [...prev, value]
    ))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() && syntaxMode === 'variable') {
      return
    }

    const parsedColumns = headersColumns.trim() ? Number(headersColumns.trim()) : null
    const normalizedIndicators = syntaxMode === 'variable' ? indicators : []
    const normalizedIgnoreValue = syntaxMode === 'ignore' ? (ignoreValue.trim() || undefined) : undefined
    const normalizedHeadersColumns = syntaxMode === 'headers'
      && parsedColumns !== null
      && Number.isFinite(parsedColumns)
      && parsedColumns > 0
      ? parsedColumns
      : null

    onConfirm(
      name.trim() || 'variable',
      pattern,
      normalizedIndicators,
      syntaxMode,
      {
        ignoreValue: normalizedIgnoreValue,
        headersColumns: normalizedHeadersColumns
      }
    )
  }

  const selectedIndicatorLabels = useMemo(
    () => AVAILABLE_INDICATORS.filter((indicator) => indicators.includes(indicator.value)).map((indicator) => indicator.label),
    [indicators]
  )

  const templateSyntax = useMemo(() => {
    if (syntaxMode === 'ignore') {
      return ignoreValue.trim()
        ? `{{ ignore("${ignoreValue.trim()}") }}`
        : '{{ ignore }}'
    }

    if (syntaxMode === 'headers') {
      const columnsValue = headersColumns.trim()
      const headerFilters = columnsValue ? `_headers_ | columns(${columnsValue})` : '_headers_'
      return `${selectedText} {{ ${headerFilters} }}`
    }

    if (syntaxMode === 'end') {
      return `${selectedText} {{ _end_ }}`
    }

    const filters = [pattern, ...indicators].filter(Boolean)
    return filters.length > 0
      ? `{{ ${name} | ${filters.join(' | ')} }}`
      : `{{ ${name} }}`
  }, [headersColumns, ignoreValue, indicators, name, pattern, selectedText, syntaxMode])

  const isVariableMode = syntaxMode === 'variable'
  const isIgnoreMode = syntaxMode === 'ignore'
  const isHeadersMode = syntaxMode === 'headers'
  const isEditMode = mode === 'edit'

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="rounded-lg p-6 w-[560px] shadow-xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
        <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
          {isEditMode ? 'Edit Variable' : 'Add Variable'}
        </h3>

        <form onSubmit={handleSubmit}>
          <div className="mb-4 p-3 rounded-md" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Selected Text</label>
            <code className="text-sm" style={{ color: '#22c55e' }}>{selectedText}</code>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Syntax Mode</label>
            <select
              value={syntaxMode}
              onChange={(e) => setSyntaxMode(e.target.value as VariableSyntaxMode)}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2"
              style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
            >
              {SYNTAX_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              {SYNTAX_MODE_OPTIONS.find((option) => option.value === syntaxMode)?.description}
            </p>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Variable Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., ip_address, interface_name"
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2"
              style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
              autoFocus
              disabled={!isVariableMode}
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Pattern</label>
            <select
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2"
              style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
              disabled={!isVariableMode}
            >
              <option value="">None (default)</option>
              {Object.entries(patterns).map(([key, value]) => (
                <option key={key} value={key}>
                  {key} - {value.description}
                </option>
              ))}
            </select>
            {pattern && patterns[pattern] && isVariableMode && (
              <p className="mt-2 text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                Regex: {patterns[pattern].regex}
              </p>
            )}
          </div>

          {isIgnoreMode && (
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Ignore Value (optional)</label>
              <input
                type="text"
                value={ignoreValue}
                onChange={(e) => setIgnoreValue(e.target.value)}
                placeholder="e.g., IP or pattern_var"
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2"
                style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
              />
              <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                When set, the generated syntax will be <code>{'{{ ignore("value") }}'}</code>.
              </p>
            </div>
          )}

          {isHeadersMode && (
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>columns(n) (optional)</label>
              <input
                type="number"
                min="1"
                value={headersColumns}
                onChange={(e) => setHeadersColumns(e.target.value)}
                placeholder="e.g., 5"
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2"
                style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
              />
              <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                When set, the generated syntax will append | columns(n) after _headers_.
              </p>
            </div>
          )}

          <div className="mb-6">
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Indicators</label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsIndicatorMenuOpen((open) => !open)}
                disabled={!isVariableMode}
                className="w-full px-3 py-2 border rounded-md text-left flex items-center justify-between"
                style={{
                  backgroundColor: 'var(--bg-tertiary)',
                  borderColor: 'var(--border-color)',
                  color: isVariableMode ? 'var(--text-primary)' : 'var(--text-muted)',
                  opacity: isVariableMode ? 1 : 0.7
                }}
              >
                <span>
                  {selectedIndicatorLabels.length > 0 ? selectedIndicatorLabels.join(', ') : 'Select indicators...'}
                </span>
                <svg className={`w-4 h-4 transition-transform ${isIndicatorMenuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isIndicatorMenuOpen && isVariableMode && (
                <div
                  className="absolute z-10 mt-2 w-full rounded-md border shadow-lg p-2 space-y-2"
                  style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}
                >
                  {AVAILABLE_INDICATORS.map((indicator) => {
                    const checked = indicators.includes(indicator.value)
                    return (
                      <label
                        key={indicator.value}
                        className="flex items-start gap-3 p-2 rounded-md cursor-pointer"
                        style={{
                          backgroundColor: checked ? 'rgba(59, 130, 246, 0.12)' : 'transparent',
                          color: 'var(--text-primary)'
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleIndicator(indicator.value)}
                          className="mt-1 h-4 w-4 accent-blue-500"
                        />
                        <div>
                          <div className="text-sm font-mono">{indicator.label}</div>
                          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{indicator.description}</div>
                        </div>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
            {!isVariableMode && (
              <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                Indicators are only used for standard variable mode.
              </p>
            )}
          </div>

          <div className="mb-6 p-3 rounded-md" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Template Syntax</label>
            <code className="text-sm" style={{ color: '#3b82f6' }}>
              {templateSyntax}
            </code>
          </div>

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
              {isEditMode ? 'Save Changes' : 'Add Variable'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
