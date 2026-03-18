import axios from 'axios'

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

export interface ParseResult {
  success: boolean
  result?: unknown
  csvResult?: string
  checkupCsvResult?: string
  error?: string
  errorType?: string
}

export interface Pattern {
  regex: string
  description: string
}

interface ParseResponse {
  success: boolean
  result?: unknown
  csv_result?: string
  checkup_csv_result?: string
  error?: string
  error_type?: string
}

interface PatternsResponse {
  patterns: Record<string, Pattern>
}

export interface SavedTemplate {
  id: string
  name: string
  description: string
  sampleText: string
  variables: Array<Record<string, unknown>>
  groups: Array<Record<string, unknown>>
  generatedTemplate: string
  createdAt: number
  updatedAt: number
}

export interface SavedTemplatePayload {
  name: string
  description: string
  sampleText: string
  variables: Array<Record<string, unknown>>
  groups: Array<Record<string, unknown>>
  generatedTemplate: string
}

interface SavedTemplateResponse {
  id: string
  name: string
  description: string
  sample_text: string
  variables: Array<Record<string, unknown>>
  groups: Array<Record<string, unknown>>
  generated_template: string
  created_at: number
  updated_at: number
}

interface TemplatesResponse {
  templates: SavedTemplateResponse[]
}

function mapSavedTemplate(template: SavedTemplateResponse): SavedTemplate {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    sampleText: template.sample_text,
    variables: template.variables,
    groups: template.groups,
    generatedTemplate: template.generated_template,
    createdAt: template.created_at,
    updatedAt: template.updated_at
  }
}

function mapSavedTemplatePayload(template: SavedTemplatePayload): Record<string, unknown> {
  return {
    name: template.name,
    description: template.description,
    sample_text: template.sampleText,
    variables: template.variables,
    groups: template.groups,
    generated_template: template.generatedTemplate
  }
}

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
    checkupCsvResult: response.data.checkup_csv_result,
    error: response.data.error,
    errorType: response.data.error_type
  }
}

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
    checkupCsvResult: response.data.checkup_csv_result,
    error: response.data.error,
    errorType: response.data.error_type
  }
}

export async function getPatterns(): Promise<Record<string, Pattern>> {
  const response = await api.get<PatternsResponse>('/patterns')
  return response.data.patterns
}

export async function getTemplates(): Promise<SavedTemplate[]> {
  const response = await api.get<TemplatesResponse>('/templates')
  return response.data.templates.map(mapSavedTemplate)
}

export async function createTemplate(template: SavedTemplatePayload): Promise<SavedTemplate> {
  const response = await api.post<SavedTemplateResponse>('/templates', mapSavedTemplatePayload(template))
  return mapSavedTemplate(response.data)
}

export async function updateTemplate(templateId: string, template: SavedTemplatePayload): Promise<SavedTemplate> {
  const response = await api.put<SavedTemplateResponse>(`/templates/${templateId}`, mapSavedTemplatePayload(template))
  return mapSavedTemplate(response.data)
}

export async function deleteTemplate(templateId: string): Promise<void> {
  await api.delete(`/templates/${templateId}`)
}
