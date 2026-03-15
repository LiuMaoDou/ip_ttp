import axios from 'axios'
import { ParseResult, Pattern } from '../store/useStore'

const API_BASE = '/api'

export const api = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json'
  }
})

export interface ParseRequest {
  data: string
  template: string
  name?: string
}

export interface ParseResponse {
  success: boolean
  result?: unknown
  csv_result?: string
  error?: string
  error_type?: string
}

export interface PatternsResponse {
  patterns: Record<string, Pattern>
}

// Parse text data
export async function parseText(data: string, template: string, name?: string): Promise<ParseResult> {
  const response = await api.post<ParseResponse>('/parse', {
    data,
    template,
    name
  })
  return {
    success: response.data.success,
    result: response.data.result,
    csvResult: response.data.csv_result,
    error: response.data.error,
    errorType: response.data.error_type
  }
}

// Parse file
export async function parseFile(file: File, template: string): Promise<ParseResult> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('template', template)

  const response = await api.post<ParseResponse>('/parse/file', formData, {
    headers: {
      'Content-Type': 'multipart/form-data'
    }
  })
  return {
    success: response.data.success,
    result: response.data.result,
    csvResult: response.data.csv_result,
    error: response.data.error,
    errorType: response.data.error_type
  }
}

// Get available patterns
export async function getPatterns(): Promise<Record<string, Pattern>> {
  const response = await api.get<PatternsResponse>('/patterns')
  return response.data.patterns
}
