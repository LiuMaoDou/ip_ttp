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

const CUSTOM_REGEX_SENTINEL = '__custom_regex__'

function extractCustomRegex(pattern: string): string | null {
  const match = pattern.match(/^re\("(.*)"\)$/s)
  return match ? match[1] : null
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
  const [customRegex, setCustomRegex] = useState('')
  const [extraFilters, setExtraFilters] = useState('')
  const [indicators, setIndicators] = useState<string[]>([])
  const [syntaxMode, setSyntaxMode] = useState<VariableSyntaxMode>('variable')
  const [ignoreValue, setIgnoreValue] = useState('')
  const [headersColumns, setHeadersColumns] = useState('')
  const [isIndicatorMenuOpen, setIsIndicatorMenuOpen] = useState(false)
  const [isSyntaxModeOpen, setIsSyntaxModeOpen] = useState(false)
  const [isPatternOpen, setIsPatternOpen] = useState(false)

  useEffect(() => {
    const isEditMode = mode === 'edit'
    const initialPattern = isEditMode ? (initialVariable?.pattern || '') : getDefaultPattern(selectedText)
    const extractedRegex = extractCustomRegex(initialPattern)

    setName(isEditMode ? (initialVariable?.name || 'variable') : getDefaultVariableName(selectedText))
    if (extractedRegex !== null) {
      setPattern(CUSTOM_REGEX_SENTINEL)
      setCustomRegex(extractedRegex)
    } else {
      setPattern(initialPattern)
      setCustomRegex('')
    }
    setExtraFilters('')
    setIndicators(isEditMode ? (initialVariable?.indicators || []) : [])
    setSyntaxMode(isEditMode ? (initialVariable?.syntaxMode || 'variable') : 'variable')
    setIgnoreValue(isEditMode ? (initialVariable?.ignoreValue || '') : '')
    setHeadersColumns(
      isEditMode && initialVariable?.headersColumns != null
        ? String(initialVariable.headersColumns)
        : ''
    )
    setIsIndicatorMenuOpen(false)
    setIsSyntaxModeOpen(false)
    setIsPatternOpen(false)
  }, [mode, selectedText, initialVariable])

  useEffect(() => {
    if (syntaxMode !== 'variable') {
      setIsIndicatorMenuOpen(false)
    }
    setIsSyntaxModeOpen(false)
  }, [syntaxMode])

  const toggleIndicator = (value: string) => {
    setIndicators((prev) => (
      prev.includes(value)
        ? prev.filter((indicator) => indicator !== value)
        : [...prev, value]
    ))
  }

  const effectivePattern = useMemo(() => {
    if (pattern !== CUSTOM_REGEX_SENTINEL) {
      return pattern
    }

    const trimmed = customRegex.trim()
    return trimmed ? `re("${trimmed}")` : ''
  }, [pattern, customRegex])

  const extraFilterTokens = useMemo(
    () => extraFilters.split('|').map((token) => token.trim()).filter(Boolean),
    [extraFilters]
  )

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() && syntaxMode === 'variable') {
      return
    }

    const parsedColumns = headersColumns.trim() ? Number(headersColumns.trim()) : null
    const mergedIndicators = syntaxMode === 'variable'
      ? [...indicators, ...extraFilterTokens]
      : []
    const normalizedIgnoreValue = syntaxMode === 'ignore' ? (ignoreValue.trim() || undefined) : undefined
    const normalizedHeadersColumns = syntaxMode === 'headers'
      && parsedColumns !== null
      && Number.isFinite(parsedColumns)
      && parsedColumns > 0
      ? parsedColumns
      : null

    onConfirm(
      name.trim() || 'variable',
      effectivePattern,
      mergedIndicators,
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

    const filters = [effectivePattern, ...indicators, ...extraFilterTokens].filter(Boolean)
    return filters.length > 0
      ? `{{ ${name} | ${filters.join(' | ')} }}`
      : `{{ ${name} }}`
  }, [effectivePattern, extraFilterTokens, headersColumns, ignoreValue, indicators, name, selectedText, syntaxMode])

  const isVariableMode = syntaxMode === 'variable'
  const isIgnoreMode = syntaxMode === 'ignore'
  const isHeadersMode = syntaxMode === 'headers'
  const isEditMode = mode === 'edit'

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'var(--overlay-backdrop)' }}>
      <div className="template-entity-modal rounded-lg p-6 w-[560px] shadow-xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
        <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
          {isEditMode ? 'Edit Variable' : 'Add Variable'}
        </h3>

        <form onSubmit={handleSubmit}>
          <div className="mb-3 px-3 py-2 rounded-md" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
            <label className="block text-xs mb-0.5" style={{ color: 'var(--text-muted)' }}>Selected Text</label>
            <code className="text-sm" style={{ color: '#22c55e' }}>{selectedText}</code>
          </div>

          <div className="mb-3">
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Syntax Mode</label>
            <div className="relative">
              <button
                type="button"
                onClick={() => { setIsSyntaxModeOpen((o) => !o); setIsPatternOpen(false); setIsIndicatorMenuOpen(false) }}
                className="w-full px-3 py-1.5 text-sm border rounded-md text-left flex items-center justify-between focus:outline-none focus:ring-1"
                style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
              >
                <span>{SYNTAX_MODE_OPTIONS.find((o) => o.value === syntaxMode)?.label}</span>
                <svg className={`w-3.5 h-3.5 transition-transform ${isSyntaxModeOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--text-muted)' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {isSyntaxModeOpen && (
                <div
                  className="absolute z-20 top-full mt-1 w-full rounded-md border shadow-lg p-1 space-y-0.5"
                  style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)' }}
                >
                  {SYNTAX_MODE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => { setSyntaxMode(option.value as VariableSyntaxMode); setIsSyntaxModeOpen(false) }}
                      className="w-full text-left px-2 py-1 rounded text-xs hover:bg-blue-500/10"
                      style={{ color: syntaxMode === option.value ? '#3b82f6' : 'var(--text-primary)' }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
              {SYNTAX_MODE_OPTIONS.find((option) => option.value === syntaxMode)?.description}
            </p>
          </div>

          <div className="mb-3">
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Variable Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., ip_address, interface_name"
              className="w-full px-3 py-1.5 text-sm border rounded-md focus:outline-none focus:ring-1"
              style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
              autoFocus
              disabled={!isVariableMode}
            />
          </div>

          <div className="mb-3">
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Pattern</label>
            <div className="relative">
              <button
                type="button"
                onClick={() => { if (isVariableMode) { setIsPatternOpen((o) => !o); setIsSyntaxModeOpen(false); setIsIndicatorMenuOpen(false) } }}
                disabled={!isVariableMode}
                className="w-full px-3 py-1.5 text-sm border rounded-md text-left flex items-center justify-between focus:outline-none focus:ring-1"
                style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: isVariableMode ? 'var(--text-primary)' : 'var(--text-muted)', opacity: isVariableMode ? 1 : 0.7 }}
              >
                <span>
                  {pattern === CUSTOM_REGEX_SENTINEL
                    ? 'Custom Regex (re("..."))'
                    : pattern
                      ? `${pattern} - ${patterns[pattern]?.description}`
                      : 'None (default)'}
                </span>
                <svg className={`w-3.5 h-3.5 transition-transform shrink-0 ${isPatternOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--text-muted)' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {isPatternOpen && isVariableMode && (
                <div
                  className="absolute z-20 top-full mt-1 w-full rounded-md border shadow-lg p-1 space-y-0.5 max-h-48 overflow-y-auto"
                  style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)' }}
                >
                  <button
                    type="button"
                    onClick={() => { setPattern(''); setIsPatternOpen(false) }}
                    className="w-full text-left px-2 py-1 rounded text-xs hover:bg-blue-500/10"
                    style={{ color: pattern === '' ? '#3b82f6' : 'var(--text-primary)' }}
                  >
                    None (default)
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPattern(CUSTOM_REGEX_SENTINEL); setIsPatternOpen(false) }}
                    className="w-full text-left px-2 py-1 rounded text-xs hover:bg-blue-500/10"
                    style={{ color: pattern === CUSTOM_REGEX_SENTINEL ? '#3b82f6' : 'var(--text-primary)' }}
                  >
                    <span className="font-mono">Custom Regex</span>
                    <span style={{ color: 'var(--text-muted)' }}> — wraps your regex as re("...")</span>
                  </button>
                  {Object.entries(patterns).map(([key, value]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => { setPattern(key); setIsPatternOpen(false) }}
                      className="w-full text-left px-2 py-1 rounded text-xs hover:bg-blue-500/10"
                      style={{ color: pattern === key ? '#3b82f6' : 'var(--text-primary)' }}
                    >
                      <span className="font-mono">{key}</span>
                      <span style={{ color: 'var(--text-muted)' }}> — {value.description}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {pattern && pattern !== CUSTOM_REGEX_SENTINEL && patterns[pattern] && isVariableMode && (
              <p className="mt-1 text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                Regex: {patterns[pattern].regex}
              </p>
            )}
            {pattern === CUSTOM_REGEX_SENTINEL && isVariableMode && (
              <div className="mt-2">
                <input
                  type="text"
                  value={customRegex}
                  onChange={(e) => setCustomRegex(e.target.value)}
                  placeholder='e.g., [^.\n]+'
                  className="w-full px-3 py-1.5 text-sm border rounded-md font-mono focus:outline-none focus:ring-1"
                  style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                />
                <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                  Output: <code>{'re("'}{customRegex || '...'}{'")'}</code>
                </p>
              </div>
            )}
          </div>

          {isVariableMode && (
            <div className="mb-3">
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Additional Filters (optional)</label>
              <input
                type="text"
                value={extraFilters}
                onChange={(e) => setExtraFilters(e.target.value)}
                placeholder="e.g., to_int | upper | replaceall('x','y')"
                className="w-full px-3 py-1.5 text-sm border rounded-md font-mono focus:outline-none focus:ring-1"
                style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
              />
              <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                Free-form TTP filter chain appended after the pattern and indicators. Separate multiple filters with <code>|</code>.
              </p>
            </div>
          )}

          {isIgnoreMode && (
            <div className="mb-3">
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Ignore Value (optional)</label>
              <input
                type="text"
                value={ignoreValue}
                onChange={(e) => setIgnoreValue(e.target.value)}
                placeholder="e.g., IP or pattern_var"
                className="w-full px-3 py-1.5 text-sm border rounded-md focus:outline-none focus:ring-1"
                style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
              />
              <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                When set, the generated syntax will be <code>{'{{ ignore("value") }}'}</code>.
              </p>
            </div>
          )}

          {isHeadersMode && (
            <div className="mb-3">
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-primary)' }}>columns(n) (optional)</label>
              <input
                type="number"
                min="1"
                value={headersColumns}
                onChange={(e) => setHeadersColumns(e.target.value)}
                placeholder="e.g., 5"
                className="w-full px-3 py-1.5 text-sm border rounded-md focus:outline-none focus:ring-1"
                style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
              />
              <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                When set, the generated syntax will append | columns(n) after _headers_.
              </p>
            </div>
          )}

          <div className="mb-4">
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Indicators</label>
            <div className="relative">
              <button
                type="button"
                onClick={() => { setIsIndicatorMenuOpen((open) => !open); setIsSyntaxModeOpen(false); setIsPatternOpen(false) }}
                disabled={!isVariableMode}
                className="w-full px-3 py-1.5 text-sm border rounded-md text-left flex items-center justify-between focus:outline-none focus:ring-1"
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
                <svg className={`w-3.5 h-3.5 transition-transform ${isIndicatorMenuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isIndicatorMenuOpen && isVariableMode && (
                <div
                  className="absolute z-20 top-full mt-1 w-full rounded-md border shadow-lg p-1 space-y-0.5"
                  style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)' }}
                >
                  {AVAILABLE_INDICATORS.map((indicator) => {
                    const checked = indicators.includes(indicator.value)
                    return (
                      <label
                        key={indicator.value}
                        className="flex items-center gap-2 px-2 py-1 rounded cursor-pointer"
                        style={{
                          backgroundColor: checked ? 'rgba(59, 130, 246, 0.12)' : 'transparent',
                          color: 'var(--text-primary)'
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleIndicator(indicator.value)}
                          className="h-3.5 w-3.5 accent-blue-500 shrink-0"
                        />
                        <span className="text-xs font-mono">{indicator.label}</span>
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>— {indicator.description}</span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
            {!isVariableMode && (
              <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                Indicators are only used for standard variable mode.
              </p>
            )}
          </div>

          <div className="mb-4 px-3 py-2 rounded-md" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
            <label className="block text-xs mb-0.5" style={{ color: 'var(--text-muted)' }}>Template Syntax</label>
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
