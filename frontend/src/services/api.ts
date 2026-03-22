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
  vendor: string
  categoryPath: string[]
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
  vendor: string
  categoryPath: string[]
  sampleText: string
  variables: Array<Record<string, unknown>>
  groups: Array<Record<string, unknown>>
  generatedTemplate: string
}

interface SavedTemplateResponse {
  id: string
  name: string
  description: string
  vendor: string
  category_path: string[]
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

export interface GenerationSourceTemplate {
  templateId: string
  templateName: string
  templateAlias: string
}

export interface GenerationBindingReference {
  templateId: string
  templateName: string
  templateAlias: string
  groupPath: string[]
  variableName: string
  selector: string
  expression: string
}

export interface GenerationBinding {
  id: string
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  originalText: string
  reference: GenerationBindingReference
}

export interface GenerationTemplate {
  id: string
  name: string
  description: string
  vendor: string
  categoryPath: string[]
  templateText: string
  sourceTemplates: GenerationSourceTemplate[]
  bindings: GenerationBinding[]
  createdAt: number
  updatedAt: number
}

export interface GenerationTemplatePayload {
  name: string
  description: string
  vendor: string
  categoryPath: string[]
  templateText: string
  sourceTemplates: GenerationSourceTemplate[]
  bindings: GenerationBinding[]
}

interface GenerationSourceTemplateResponse {
  template_id: string
  template_name: string
  template_alias: string
}

interface GenerationBindingReferenceResponse {
  template_id: string
  template_name: string
  template_alias: string
  group_path?: string[]
  variable_name: string
  selector: string
  expression?: string
}

interface GenerationBindingResponse {
  id: string
  start_line: number
  start_column: number
  end_line: number
  end_column: number
  original_text: string
  reference: GenerationBindingReferenceResponse
}

interface GenerationTemplateResponse {
  id: string
  name: string
  description: string
  vendor: string
  category_path: string[]
  template_text: string
  source_templates: GenerationSourceTemplateResponse[]
  bindings: GenerationBindingResponse[]
  created_at: number
  updated_at: number
}

interface GenerationTemplatesResponse {
  templates: GenerationTemplateResponse[]
}

export type TemplateKind = 'parse' | 'generation'

export interface VendorRecord {
  name: string
  createdAt: number
  updatedAt: number
}

export interface TemplateCategory {
  id: string
  vendor: string
  name: string
  parentId: string | null
  path: string[]
  createdAt: number
  updatedAt: number
}

interface VendorResponse {
  name: string
  created_at: number
  updated_at: number
}

interface VendorsResponse {
  vendors: VendorResponse[]
}

export interface TemplateCategoryPayload {
  name: string
  vendor: string
  parentId?: string | null
}

interface TemplateCategoryResponse {
  id: string
  vendor: string
  name: string
  parent_id?: string | null
  path: string[]
  created_at: number
  updated_at: number
}

interface CategoriesResponse {
  categories: TemplateCategoryResponse[]
}

export interface GenerationRenderResult {
  fileName: string
  success: boolean
  generatedText?: string
  error?: string
  errorType?: string
}

interface GenerationRenderResultResponse {
  file_name: string
  success: boolean
  generated_text?: string
  error?: string
  error_type?: string
}

interface RenderGenerationResponse {
  results: GenerationRenderResultResponse[]
}

function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail
    if (typeof detail === 'string' && detail.trim()) {
      return detail
    }

    if (Array.isArray(detail) && detail.length > 0) {
      const firstDetail = detail[0]
      if (typeof firstDetail === 'string' && firstDetail.trim()) {
        return firstDetail
      }
      if (firstDetail && typeof firstDetail === 'object' && 'msg' in firstDetail && typeof firstDetail.msg === 'string') {
        return firstDetail.msg
      }
    }

    if (typeof error.message === 'string' && error.message.trim()) {
      return error.message
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  return 'Request failed'
}

function mapSavedTemplate(template: SavedTemplateResponse): SavedTemplate {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    vendor: template.vendor,
    categoryPath: template.category_path || [],
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
    vendor: template.vendor,
    category_path: template.categoryPath,
    sample_text: template.sampleText,
    variables: template.variables,
    groups: template.groups,
    generated_template: template.generatedTemplate
  }
}

function mapGenerationSourceTemplate(template: GenerationSourceTemplateResponse): GenerationSourceTemplate {
  return {
    templateId: template.template_id,
    templateName: template.template_name,
    templateAlias: template.template_alias
  }
}

function mapGenerationBindingReference(reference: GenerationBindingReferenceResponse): GenerationBindingReference {
  return {
    templateId: reference.template_id,
    templateName: reference.template_name,
    templateAlias: reference.template_alias,
    groupPath: reference.group_path || [],
    variableName: reference.variable_name,
    selector: reference.selector,
    expression: reference.expression || ''
  }
}

function mapGenerationBinding(binding: GenerationBindingResponse): GenerationBinding {
  return {
    id: binding.id,
    startLine: binding.start_line,
    startColumn: binding.start_column,
    endLine: binding.end_line,
    endColumn: binding.end_column,
    originalText: binding.original_text,
    reference: mapGenerationBindingReference(binding.reference)
  }
}

function mapGenerationTemplate(template: GenerationTemplateResponse): GenerationTemplate {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    vendor: template.vendor,
    categoryPath: template.category_path || [],
    templateText: template.template_text,
    sourceTemplates: template.source_templates.map(mapGenerationSourceTemplate),
    bindings: template.bindings.map(mapGenerationBinding),
    createdAt: template.created_at,
    updatedAt: template.updated_at
  }
}

function mapGenerationTemplatePayload(template: GenerationTemplatePayload): Record<string, unknown> {
  return {
    name: template.name,
    description: template.description,
    vendor: template.vendor,
    category_path: template.categoryPath,
    template_text: template.templateText,
    source_templates: template.sourceTemplates.map((sourceTemplate) => ({
      template_id: sourceTemplate.templateId,
      template_name: sourceTemplate.templateName,
      template_alias: sourceTemplate.templateAlias
    })),
    bindings: template.bindings.map((binding) => ({
      id: binding.id,
      start_line: binding.startLine,
      start_column: binding.startColumn,
      end_line: binding.endLine,
      end_column: binding.endColumn,
      original_text: binding.originalText,
      reference: {
        template_id: binding.reference.templateId,
        template_name: binding.reference.templateName,
        template_alias: binding.reference.templateAlias,
        group_path: binding.reference.groupPath,
        variable_name: binding.reference.variableName,
        selector: binding.reference.selector,
        expression: binding.reference.expression
      }
    }))
  }
}

function mapGenerationRenderResult(result: GenerationRenderResultResponse): GenerationRenderResult {
  return {
    fileName: result.file_name,
    success: result.success,
    generatedText: result.generated_text,
    error: result.error,
    errorType: result.error_type
  }
}

function mapVendor(vendor: VendorResponse): VendorRecord {
  return {
    name: vendor.name,
    createdAt: vendor.created_at,
    updatedAt: vendor.updated_at
  }
}

function mapCategory(category: TemplateCategoryResponse): TemplateCategory {
  return {
    id: category.id,
    vendor: category.vendor,
    name: category.name,
    parentId: category.parent_id || null,
    path: category.path || [],
    createdAt: category.created_at,
    updatedAt: category.updated_at
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

export async function getVendors(): Promise<VendorRecord[]> {
  const response = await api.get<VendorsResponse>('/template-library/vendors')
  return response.data.vendors.map(mapVendor)
}

export async function createVendor(name: string): Promise<VendorRecord> {
  const response = await api.post<VendorResponse>('/template-library/vendors', { name })
  return mapVendor(response.data)
}

export async function renameVendor(currentName: string, name: string): Promise<VendorRecord> {
  const response = await api.put<VendorResponse>(`/template-library/vendors/${encodeURIComponent(currentName)}`, { name })
  return mapVendor(response.data)
}

export async function deleteVendor(name: string): Promise<void> {
  await api.delete(`/template-library/vendors/${encodeURIComponent(name)}`)
}

export async function getCategories(templateKind: TemplateKind): Promise<TemplateCategory[]> {
  const response = await api.get<CategoriesResponse>(`/template-library/${templateKind}/categories`)
  return response.data.categories.map(mapCategory)
}

export async function createCategory(templateKind: TemplateKind, payload: TemplateCategoryPayload): Promise<TemplateCategory> {
  const response = await api.post<TemplateCategoryResponse>(`/template-library/${templateKind}/categories`, {
    name: payload.name,
    vendor: payload.vendor,
    parent_id: payload.parentId ?? null
  })
  return mapCategory(response.data)
}

export async function updateCategory(templateKind: TemplateKind, categoryId: string, payload: TemplateCategoryPayload): Promise<TemplateCategory> {
  const response = await api.put<TemplateCategoryResponse>(`/template-library/${templateKind}/categories/${categoryId}`, {
    name: payload.name,
    vendor: payload.vendor,
    parent_id: payload.parentId ?? null
  })
  return mapCategory(response.data)
}

export async function deleteCategory(templateKind: TemplateKind, categoryId: string): Promise<void> {
  await api.delete(`/template-library/${templateKind}/categories/${categoryId}`)
}

export async function getGenerationTemplates(): Promise<GenerationTemplate[]> {
  const response = await api.get<GenerationTemplatesResponse>('/generation/templates')
  return response.data.templates.map(mapGenerationTemplate)
}

export async function createGenerationTemplate(template: GenerationTemplatePayload): Promise<GenerationTemplate> {
  const response = await api.post<GenerationTemplateResponse>('/generation/templates', mapGenerationTemplatePayload(template))
  return mapGenerationTemplate(response.data)
}

export async function updateGenerationTemplate(templateId: string, template: GenerationTemplatePayload): Promise<GenerationTemplate> {
  const response = await api.put<GenerationTemplateResponse>(`/generation/templates/${templateId}`, mapGenerationTemplatePayload(template))
  return mapGenerationTemplate(response.data)
}

export async function deleteGenerationTemplate(templateId: string): Promise<void> {
  await api.delete(`/generation/templates/${templateId}`)
}

export async function renderGenerationFiles(
  template: GenerationTemplatePayload,
  files: File[],
  generationTemplateId?: string | null
): Promise<GenerationRenderResult[]> {
  const formData = new FormData()
  if (generationTemplateId) {
    formData.append('generation_template_id', generationTemplateId)
  } else {
    formData.append('generation_template', JSON.stringify(mapGenerationTemplatePayload(template)))
  }
  files.forEach((file) => {
    formData.append('files', file)
  })

  try {
    const response = await api.post<RenderGenerationResponse>('/generation/render', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    })

    return response.data.results.map(mapGenerationRenderResult)
  } catch (error) {
    throw new Error(getErrorMessage(error))
  }
}
