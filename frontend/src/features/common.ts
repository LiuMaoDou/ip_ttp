import type { Group, SavedTemplate, Variable } from '../store/useStore'

export const VARIABLE_COLORS = [
  '#388bfd', '#3fb950', '#bc8cff', '#f0883e', '#f85149',
  '#39d3bb', '#e3b341', '#58a6ff', '#7ee787', '#d2a8ff'
]

export function variableColor(index: number) {
  return VARIABLE_COLORS[index % VARIABLE_COLORS.length]
}

export function fileSizeLabel(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${size} B`
}

export function templatePath(template: Pick<SavedTemplate, 'vendor' | 'categoryPath'>) {
  return [template.vendor || 'Unassigned', ...(template.categoryPath || [])].join(' / ')
}

export function createVariableFromSelection(
  text: string,
  selection: { startLine: number; startColumn: number; endLine: number; endColumn: number },
  name: string,
  pattern: string,
  indicators: string[]
): Omit<Variable, 'id' | 'colorIndex'> {
  return {
    name,
    pattern,
    indicators,
    syntaxMode: 'variable',
    startLine: selection.startLine,
    startColumn: selection.startColumn,
    endLine: selection.endLine,
    endColumn: selection.endColumn,
    originalText: text
  }
}

export function createGroupFromSelection(
  selection: { startLine: number; endLine: number },
  name: string
): Omit<Group, 'id' | 'colorIndex'> {
  return {
    name,
    startLine: selection.startLine,
    endLine: selection.endLine
  }
}

export function downloadText(fileName: string, content: string, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

export function getDefaultVariableName(selectedText: string) {
  const name = selectedText
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32)
  return name || 'variable'
}

export function getDefaultPattern(selectedText: string) {
  const trimmed = selectedText.trim()
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(trimmed)) return 'IP'
  if (/^\d+$/.test(trimmed)) return 'DIGIT'
  if (/^\S+$/.test(trimmed)) return 'WORD'
  return 'ORPHRASE'
}
