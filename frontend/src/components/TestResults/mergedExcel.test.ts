import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import type { FileParseResult } from '../../store/useStore'
import { buildMergedExcelSheets, buildMergedExcelWorkbook } from './mergedExcel'

function getWorksheetRows(workbook: XLSX.WorkBook, sheetName: string): Array<Record<string, unknown>> {
  const worksheet = workbook.Sheets[sheetName]
  if (!worksheet) {
    throw new Error(`Missing worksheet: ${sheetName}`)
  }

  return XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: null,
  })
}

describe('buildMergedExcelSheets', () => {
  it('groups results by template and keeps fileName as the first header', () => {
    const results: FileParseResult[] = [
      {
        fileId: 'file-1',
        fileName: 'edge-1.txt',
        templateId: 'tpl-1',
        templateName: 'Interfaces',
        result: { hostname: 'edge-1' },
        success: true,
      },
    ]

    const [sheet] = buildMergedExcelSheets(results)

    expect(sheet.templateName).toBe('Interfaces')
    expect(sheet.headers[0]).toBe('fileName')
    expect(sheet.rows).toEqual([
      {
        fileName: 'edge-1.txt',
        hostname: 'edge-1',
      },
    ])
  })

  it('flattens nested objects and expands arrays into multiple rows', () => {
    const results: FileParseResult[] = [
      {
        fileId: 'file-1',
        fileName: 'edge-1.txt',
        templateId: 'tpl-1',
        templateName: 'Interfaces',
        result: {
          device: {
            hostname: 'edge-1',
          },
          interfaces: [
            { name: 'Lo0', ip: '1.1.1.1' },
            { name: 'Lo1', ip: '2.2.2.2' },
          ],
        },
        success: true,
      },
    ]

    const workbook = buildMergedExcelWorkbook(results)
    const rows = getWorksheetRows(workbook, 'Interfaces')

    expect(rows).toEqual([
      {
        fileName: 'edge-1.txt',
        'device.hostname': 'edge-1',
        'interfaces.name': 'Lo0',
        'interfaces.ip': '1.1.1.1',
      },
      {
        fileName: 'edge-1.txt',
        'device.hostname': 'edge-1',
        'interfaces.name': 'Lo1',
        'interfaces.ip': '2.2.2.2',
      },
    ])
  })

  it('keeps failed parses as rows with error details', () => {
    const results: FileParseResult[] = [
      {
        fileId: 'file-1',
        fileName: 'edge-1.txt',
        templateId: 'tpl-1',
        templateName: 'Interfaces',
        result: null,
        success: false,
        error: 'Template failed',
        errorType: 'ParseError',
      },
    ]

    const workbook = buildMergedExcelWorkbook(results)
    const rows = getWorksheetRows(workbook, 'Interfaces')

    expect(rows).toEqual([
      {
        fileName: 'edge-1.txt',
        error: 'Template failed',
        errorType: 'ParseError',
      },
    ])
  })

  it('creates unique sanitized worksheet names when template names collide', () => {
    const results: FileParseResult[] = [
      {
        fileId: 'file-1',
        fileName: 'edge-1.txt',
        templateId: 'tpl-1',
        templateName: 'Core/Interfaces',
        result: { hostname: 'edge-1' },
        success: true,
      },
      {
        fileId: 'file-2',
        fileName: 'edge-2.txt',
        templateId: 'tpl-2',
        templateName: 'Core?Interfaces',
        result: { hostname: 'edge-2' },
        success: true,
      },
    ]

    const sheets = buildMergedExcelSheets(results)

    expect(sheets.map((sheet) => sheet.sheetName)).toEqual([
      'Core_Interfaces',
      'Core_Interfaces (2)',
    ])
  })

  it('falls back to a value column for empty structured data', () => {
    const results: FileParseResult[] = [
      {
        fileId: 'file-1',
        fileName: 'edge-1.txt',
        templateId: 'tpl-1',
        templateName: 'Empty Result',
        result: {},
        success: true,
      },
    ]

    const workbook = buildMergedExcelWorkbook(results)
    const rows = getWorksheetRows(workbook, 'Empty Result')

    expect(rows).toEqual([
      {
        fileName: 'edge-1.txt',
        value: '{}',
      },
    ])
  })
})
