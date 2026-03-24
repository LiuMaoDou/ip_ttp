import * as XLSX from 'xlsx'
import type { FileParseResult } from '../../store/useStore'

type ExcelCellValue = string | number | boolean | null
type FlatRow = Record<string, ExcelCellValue>

export interface MergedExcelSheet {
  headers: string[]
  rows: FlatRow[]
  sheetName: string
  templateName: string
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (value === undefined) {
    return ''
  }

  const json = JSON.stringify(value)
  return json === undefined ? String(value) : json
}

function toCellValue(value: unknown): ExcelCellValue {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  return stringifyValue(value)
}

function combineRows(currentRows: FlatRow[], nextRows: FlatRow[]): FlatRow[] {
  const combined: FlatRow[] = []

  currentRows.forEach((currentRow) => {
    nextRows.forEach((nextRow) => {
      combined.push({
        ...currentRow,
        ...nextRow,
      })
    })
  })

  return combined
}

function flattenValueToRows(value: unknown, path: string[] = []): FlatRow[] {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [{}]
    }

    return value.flatMap((item) => flattenValueToRows(item, path))
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value)
    if (entries.length === 0) {
      return [{}]
    }

    let rows: FlatRow[] = [{}]
    entries.forEach(([key, childValue]) => {
      rows = combineRows(rows, flattenValueToRows(childValue, [...path, key]))
    })
    return rows
  }

  if (path.length === 0) {
    return value === undefined ? [{}] : [{ value: toCellValue(value) }]
  }

  return [{
    [path.join('.')]: toCellValue(value),
  }]
}

function buildRowsForResult(result: FileParseResult): FlatRow[] {
  if (!result.success) {
    return [{
      fileName: result.fileName,
      error: result.error || 'Unknown error',
      errorType: result.errorType || null,
    }]
  }

  const flattenedRows = flattenValueToRows(result.result)
  const hasStructuredColumns = flattenedRows.some((row) => Object.keys(row).length > 0)

  if (!hasStructuredColumns) {
    return [{
      fileName: result.fileName,
      value: stringifyValue(result.result),
    }]
  }

  return flattenedRows.map((row) => ({
    fileName: result.fileName,
    ...row,
  }))
}

function collectHeaders(rows: FlatRow[]): string[] {
  const headers = ['fileName']
  const seen = new Set(headers)

  rows.forEach((row) => {
    Object.keys(row).forEach((key) => {
      if (seen.has(key)) {
        return
      }

      seen.add(key)
      headers.push(key)
    })
  })

  return headers
}

function sanitizeSheetName(templateName: string): string {
  const trimmedName = templateName.trim() || 'Template'
  const sanitizedName = trimmedName.replace(/[:\\/?*\[\]]/g, '_').replace(/'/g, '').trim()
  return (sanitizedName || 'Template').slice(0, 31)
}

function buildUniqueSheetName(templateName: string, usedNames: Set<string>): string {
  const baseName = sanitizeSheetName(templateName)
  if (!usedNames.has(baseName)) {
    usedNames.add(baseName)
    return baseName
  }

  let suffix = 2
  while (true) {
    const suffixLabel = ` (${suffix})`
    const candidate = `${baseName.slice(0, 31 - suffixLabel.length)}${suffixLabel}`
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate)
      return candidate
    }
    suffix += 1
  }
}

export function buildMergedExcelSheets(results: FileParseResult[]): MergedExcelSheet[] {
  const grouped = new Map<string, { rows: FlatRow[]; templateName: string }>()

  results.forEach((result, index) => {
    const templateName = result.templateName?.trim() || 'Unnamed Template'
    const templateKey = result.templateId || result.templateName || `template-${index}`
    const existing = grouped.get(templateKey)

    if (existing) {
      existing.rows.push(...buildRowsForResult(result))
      return
    }

    grouped.set(templateKey, {
      templateName,
      rows: buildRowsForResult(result),
    })
  })

  const usedSheetNames = new Set<string>()

  return Array.from(grouped.values()).map(({ templateName, rows }) => ({
    templateName,
    sheetName: buildUniqueSheetName(templateName, usedSheetNames),
    rows,
    headers: collectHeaders(rows),
  }))
}

export function buildMergedExcelWorkbook(results: FileParseResult[]): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new()

  buildMergedExcelSheets(results).forEach((sheetData) => {
    const worksheet = XLSX.utils.json_to_sheet(sheetData.rows, {
      header: sheetData.headers,
    })
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetData.sheetName)
  })

  return workbook
}

export function buildMergedExcelBlob(results: FileParseResult[]): Blob {
  const workbook = buildMergedExcelWorkbook(results)
  const workbookBuffer = XLSX.write(workbook, {
    type: 'array',
    bookType: 'xlsx',
  })

  return new Blob(
    [workbookBuffer],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  )
}
