import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  createCategory as createCategoryRequest,
  createGenerationTemplate,
  createTemplate,
  createVendor as createVendorRequest,
  deleteCategory as deleteCategoryRequest,
  deleteGenerationTemplate as deleteGenerationTemplateRequest,
  deleteTemplate as deleteTemplateRequest,
  deleteVendor as deleteVendorRequest,
  getCategories,
  getGenerationTemplates,
  getTemplates,
  getVendors,
  renderGenerationFiles,
  renameVendor as renameVendorRequest,
  updateCategory as updateCategoryRequest,
  updateGenerationTemplate,
  updateTemplate
} from '../services/api'
import type {
  GenerationBinding,
  GenerationRenderResult,
  GenerationSourceTemplate,
  GenerationTemplate,
  GenerationTemplatePayload,
  ParseResult,
  Pattern,
  SavedTemplate,
  TemplateCategory,
  TemplateKind,
  VendorRecord
} from '../services/api'

export type {
  GenerationBinding,
  GenerationRenderResult,
  GenerationSourceTemplate,
  GenerationTemplate,
  GenerationTemplatePayload,
  ParseResult,
  Pattern,
  SavedTemplate,
  TemplateCategory,
  TemplateKind,
  VendorRecord
} from '../services/api'

export type VariableSyntaxMode = 'variable' | 'ignore' | 'headers' | 'end'

export interface Variable {
  id: string
  name: string
  pattern: string
  indicators?: string[]
  syntaxMode?: VariableSyntaxMode
  ignoreValue?: string
  headersColumns?: number | null
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  originalText: string
  colorIndex: number
}

export interface Group {
  id: string
  name: string
  startLine: number
  endLine: number
  colorIndex: number
}

export interface VariableRangeSyncUpdate {
  id: string
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  originalText: string
}

export interface GroupRangeSyncUpdate {
  id: string
  startLine: number
  endLine: number
}

export interface UploadedBatchFile {
  id: string
  name: string
  size: number
  isArchive: boolean
  content: string  // text content for text files; '' for archives
  blob?: Blob      // binary content for archives (stored natively in IndexedDB)
}

export interface UploadedFile {
  id: string
  name: string
  size: number
  content: string
  uploadGroupId?: string
  uploadGroupName?: string
}

export interface FileParseResult {
  fileId: string
  fileName: string
  templateId?: string
  templateName?: string
  result: unknown
  csvResult?: string
  checkupCsvResult?: string
  success: boolean
  error?: string
  errorType?: string
}

export interface GenerationUploadedFile {
  id: string
  file: File
  name: string
  size: number
  content: string
}

export type TemplateSaveSource = 'sample' | 'generated'

interface PreparedVariable extends Variable {
  currentText: string
}

interface AppState {
  theme: 'light' | 'dark'

  sampleText: string
  variables: Variable[]
  groups: Group[]
  generatedTemplate: string
  templateName: string
  currentTemplateVendor: string
  currentTemplateCategoryPath: string[]
  selectedSavedTemplateId: string | null

  savedTemplates: SavedTemplate[]
  vendors: VendorRecord[]
  parseCategories: TemplateCategory[]
  generationCategories: TemplateCategory[]
  isLoadingTemplates: boolean
  isLoadingTemplateDirectories: boolean

  batchUploads: UploadedBatchFile[]
  setBatchUploads: (files: UploadedBatchFile[]) => void

  files: UploadedFile[]
  selectedFileId: string | null
  inputText: string

  parseResult: ParseResult | null
  fileResults: FileParseResult[]
  selectedResultIndex: number
  selectedTestFileIds: string[] | null
  isParsing: boolean

  generationTemplateText: string
  currentGenerationTemplateVendor: string
  currentGenerationTemplateCategoryPath: string[]
  selectedGenerationTemplateId: string | null
  selectedGenerationResultIndex: number
  generationBindings: GenerationBinding[]
  generationTemplates: GenerationTemplate[]
  generationUploadedFiles: GenerationUploadedFile[]
  generationResults: GenerationRenderResult[]
  selectedGenerationFileId: string | null
  selectedGenerationSourceTemplateIds: string[]
  isLoadingGenerationTemplates: boolean
  isGeneratingConfig: boolean

  patterns: Record<string, Pattern>

  setSampleText: (text: string) => void
  addVariable: (variable: Omit<Variable, 'id' | 'colorIndex'>) => void
  removeVariable: (id: string) => void
  updateVariable: (id: string, updates: Partial<Variable>) => void
  reorderVariables: (fromIndex: number, toIndex: number) => void
  syncVariableRanges: (updates: VariableRangeSyncUpdate[]) => void
  addGroup: (group: Omit<Group, 'id' | 'colorIndex'>) => void
  removeGroup: (id: string) => void
  updateGroup: (id: string, updates: Partial<Omit<Group, 'id'>>) => void
  syncGroupRanges: (updates: GroupRangeSyncUpdate[]) => void
  setTemplateName: (name: string) => void
  generateTemplate: () => string
  clearVariables: () => void
  newTemplate: () => void
  setCurrentTemplateDirectory: (vendor: string, categoryPath: string[]) => void

  fetchSavedTemplates: () => Promise<void>
  fetchTemplateDirectories: () => Promise<void>
  createVendor: (name: string) => Promise<void>
  renameVendor: (currentName: string, nextName: string) => Promise<void>
  deleteVendor: (name: string) => Promise<void>
  createCategory: (templateKind: TemplateKind, vendor: string, name: string, parentId?: string | null) => Promise<void>
  updateCategory: (templateKind: TemplateKind, categoryId: string, vendor: string, name: string, parentId?: string | null) => Promise<void>
  deleteCategory: (templateKind: TemplateKind, categoryId: string) => Promise<void>
  saveTemplate: (name: string, description: string, vendor: string, categoryPath: string[], source?: TemplateSaveSource) => Promise<void>
  moveTemplate: (id: string, vendor: string, categoryPath: string[]) => Promise<void>
  loadTemplate: (id: string) => Promise<void>
  deleteTemplate: (id: string) => Promise<void>

  addFile: (file: UploadedFile) => void
  removeFile: (id: string) => void
  selectFile: (id: string | null) => void
  setInputText: (text: string) => void

  setParseResult: (result: ParseResult | null) => void
  setFileResults: (results: FileParseResult[]) => void
  setSelectedResultIndex: (index: number) => void
  setSelectedTestFileIds: (selectedFileIds: string[] | null | ((current: string[] | null) => string[] | null)) => void
  clearFileResults: () => void
  setIsParsing: (isParsing: boolean) => void

  setGenerationTemplateText: (text: string) => void
  setGenerationBindings: (bindings: GenerationBinding[] | ((current: GenerationBinding[]) => GenerationBinding[])) => void
  addGenerationUploadedFile: (file: GenerationUploadedFile) => void
  removeGenerationUploadedFile: (id: string) => void
  setSelectedGenerationFileId: (id: string | null) => void
  clearGenerationUploadedFiles: () => void
  setSelectedGenerationResultIndex: (index: number) => void
  setSelectedGenerationTemplateId: (id: string | null) => void
  setSelectedGenerationSourceTemplateIds: (ids: string[] | ((current: string[]) => string[])) => void
  setCurrentGenerationTemplateDirectory: (vendor: string, categoryPath: string[]) => void
  fetchGenerationTemplates: () => Promise<void>
  saveGenerationTemplate: (name: string, description: string, vendor: string, categoryPath: string[], sourceTemplates: GenerationSourceTemplate[]) => Promise<void>
  moveGenerationTemplate: (id: string, vendor: string, categoryPath: string[]) => Promise<void>
  loadGenerationTemplate: (id: string) => Promise<void>
  deleteGenerationTemplate: (id: string) => Promise<void>
  runGeneration: (options?: { name?: string; description?: string }) => Promise<void>

  setPatterns: (patterns: Record<string, Pattern>) => void

  toggleTheme: () => void
  setTheme: (theme: 'light' | 'dark') => void

  activeTab: 'template' | 'test' | 'config'
  setActiveTab: (tab: 'template' | 'test' | 'config') => void
}

const VARIABLE_COLORS = [
  '#3b82f6', '#22c55e', '#a855f7', '#f59e0b', '#ef4444', '#06b6d4',
  '#ec4899', '#84cc16', '#6366f1', '#14b8a6', '#f97316', '#8b5cf6'
]
const DEFAULT_VENDOR = 'Unassigned'

function createVariableId() {
  return `var-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

function createGroupId() {
  return `grp-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

function normalizeCategoryPath(categoryPath: string[]): string[] {
  return categoryPath.map((segment) => segment.trim()).filter(Boolean)
}

function toSavedTemplatePayload(
  state: Pick<AppState, 'sampleText' | 'variables' | 'groups' | 'generatedTemplate'>,
  vendor: string,
  categoryPath: string[]
) {
  return {
    vendor: vendor.trim() || DEFAULT_VENDOR,
    categoryPath: normalizeCategoryPath(categoryPath),
    sampleText: state.sampleText,
    variables: state.variables as unknown as Array<Record<string, unknown>>,
    groups: state.groups as unknown as Array<Record<string, unknown>>,
    generatedTemplate: state.generatedTemplate
  }
}

function toGenerationTemplatePayload(
  state: Pick<AppState, 'generationTemplateText' | 'generationBindings'>,
  name: string,
  description: string,
  vendor: string,
  categoryPath: string[],
  sourceTemplates: GenerationSourceTemplate[]
): GenerationTemplatePayload {
  return {
    name,
    description,
    vendor: vendor.trim() || DEFAULT_VENDOR,
    categoryPath: normalizeCategoryPath(categoryPath),
    templateText: state.generationTemplateText,
    sourceTemplates,
    bindings: state.generationBindings
  }
}

export function buildGenerationSourceTemplates(
  savedTemplates: SavedTemplate[],
  selectedIds: string[],
  usedAliases: Set<string> = new Set<string>()
): GenerationSourceTemplate[] {
  const savedTemplatesById = new Map(savedTemplates.map((template) => [template.id, template]))

  return selectedIds
    .map((id) => savedTemplatesById.get(id))
    .filter((template): template is SavedTemplate => Boolean(template))
    .map((template) => {
      const baseAlias = (template.name || 'template')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'template'

      let alias = baseAlias
      let index = 2
      while (usedAliases.has(alias)) {
        alias = `${baseAlias}_${index}`
        index += 1
      }
      usedAliases.add(alias)

      return {
        templateId: template.id,
        templateName: template.name,
        templateAlias: alias
      }
    })
}

function isValidPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

function getLineText(lines: string[], lineNumber: number): string | null {
  if (!isValidPositiveInteger(lineNumber) || lineNumber > lines.length) {
    return null
  }

  return lines[lineNumber - 1]
}

function getSingleLineRangeText(
  lines: string[],
  lineNumber: number,
  startColumn: number,
  endColumn: number
): string | null {
  const lineText = getLineText(lines, lineNumber)
  if (lineText === null) {
    return null
  }

  if (!isValidPositiveInteger(startColumn) || !isValidPositiveInteger(endColumn)) {
    return null
  }

  const maxColumn = lineText.length + 1
  if (startColumn >= endColumn || startColumn > maxColumn || endColumn > maxColumn) {
    return null
  }

  return lineText.substring(startColumn - 1, endColumn - 1)
}

function prepareVariableForGeneration(variable: Variable, lines: string[]): PreparedVariable | null {
  if (!isValidPositiveInteger(variable.startLine) || !isValidPositiveInteger(variable.endLine)) {
    return null
  }

  if (variable.startLine !== variable.endLine || variable.startLine > lines.length) {
    return null
  }

  const currentText = getSingleLineRangeText(
    lines,
    variable.startLine,
    variable.startColumn,
    variable.endColumn
  )

  if (currentText === null) {
    return null
  }

  return {
    ...variable,
    currentText
  }
}

function prepareGroupForGeneration(group: Group, lineCount: number): Group | null {
  if (!isValidPositiveInteger(group.startLine) || !isValidPositiveInteger(group.endLine)) {
    return null
  }

  if (group.startLine > group.endLine || group.startLine > lineCount || group.endLine > lineCount) {
    return null
  }

  return group
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      sampleText: '',
      variables: [],
      groups: [],
      generatedTemplate: '',
      templateName: '',
      currentTemplateVendor: DEFAULT_VENDOR,
      currentTemplateCategoryPath: [],
      selectedSavedTemplateId: null,
      savedTemplates: [],
      vendors: [],
      parseCategories: [],
      generationCategories: [],
      isLoadingTemplates: false,
      isLoadingTemplateDirectories: false,
      batchUploads: [],
      files: [],
      selectedFileId: null,
      inputText: '',
      parseResult: null,
      fileResults: [],
      selectedResultIndex: 0,
      selectedTestFileIds: null,
      isParsing: false,
      generationTemplateText: '',
      currentGenerationTemplateVendor: DEFAULT_VENDOR,
      currentGenerationTemplateCategoryPath: [],
      selectedGenerationTemplateId: null,
      selectedGenerationResultIndex: 0,
      generationBindings: [],
      generationTemplates: [],
      generationUploadedFiles: [],
      generationResults: [],
      selectedGenerationFileId: null,
      selectedGenerationSourceTemplateIds: [],
      isLoadingGenerationTemplates: false,
      isGeneratingConfig: false,
      patterns: {},

      setSampleText: (text) => set({ sampleText: text }),

      addVariable: (variable) => {
        const state = get()
        const colorIndex = state.variables.length % VARIABLE_COLORS.length
        const newVariable: Variable = {
          ...variable,
          id: createVariableId(),
          colorIndex
        }
        set({ variables: [...state.variables, newVariable] })
      },

      removeVariable: (id) => {
        set((state) => ({
          variables: state.variables.filter((v) => v.id !== id)
        }))
      },

      updateVariable: (id, updates) => {
        set((state) => ({
          variables: state.variables.map((v) =>
            v.id === id ? { ...v, ...updates } : v
          )
        }))
      },

      reorderVariables: (fromIndex, toIndex) => {
        const { variables } = get()
        const newVars = [...variables]
        const [moved] = newVars.splice(fromIndex, 1)
        newVars.splice(toIndex, 0, moved)
        set({ variables: newVars })
      },

      syncVariableRanges: (updates) => {
        if (updates.length === 0) {
          return
        }

        const updatesById = new Map(updates.map((update) => [update.id, update]))

        set((state) => {
          let hasChanges = false

          const variables = state.variables.map((variable) => {
            const update = updatesById.get(variable.id)
            if (!update) {
              return variable
            }

            const nextOriginalText = update.originalText !== variable.originalText
              ? update.originalText
              : variable.originalText

            const positionChanged = (
              variable.startLine !== update.startLine ||
              variable.startColumn !== update.startColumn ||
              variable.endLine !== update.endLine ||
              variable.endColumn !== update.endColumn
            )

            if (!positionChanged && nextOriginalText === variable.originalText) {
              return variable
            }

            hasChanges = true
            return {
              ...variable,
              startLine: update.startLine,
              startColumn: update.startColumn,
              endLine: update.endLine,
              endColumn: update.endColumn,
              originalText: nextOriginalText
            }
          })

          return hasChanges ? { variables } : {}
        })
      },

      addGroup: (group) => {
        const state = get()
        const colorIndex = state.groups.length % VARIABLE_COLORS.length
        const newGroup: Group = {
          ...group,
          id: createGroupId(),
          colorIndex
        }
        set({ groups: [...state.groups, newGroup] })
      },

      removeGroup: (id) => {
        set((state) => ({
          groups: state.groups.filter((g) => g.id !== id)
        }))
      },

      updateGroup: (id, updates) => {
        set((state) => ({
          groups: state.groups.map((group) =>
            group.id === id ? { ...group, ...updates } : group
          )
        }))
      },

      syncGroupRanges: (updates) => {
        if (updates.length === 0) {
          return
        }

        const updatesById = new Map(updates.map((update) => [update.id, update]))

        set((state) => {
          let hasChanges = false

          const groups = state.groups.map((group) => {
            const update = updatesById.get(group.id)
            if (!update) {
              return group
            }

            if (group.startLine === update.startLine && group.endLine === update.endLine) {
              return group
            }

            hasChanges = true
            return {
              ...group,
              startLine: update.startLine,
              endLine: update.endLine
            }
          })

          return hasChanges ? { groups } : {}
        })
      },

      setTemplateName: (name) => set({ templateName: name }),

      generateTemplate: () => {
        const state = get()
        const { sampleText, variables, groups } = state
        const lines = sampleText.split('\n')

        const preparedVariables = variables
          .map((variable) => prepareVariableForGeneration(variable, lines))
          .filter((variable): variable is PreparedVariable => variable !== null)

        const preparedGroups = groups
          .map((group) => prepareGroupForGeneration(group, lines.length))
          .filter((group): group is Group => group !== null)

        if (preparedVariables.length === 0 && preparedGroups.length === 0) {
          set({ generatedTemplate: sampleText })
          return sampleText
        }

        const sortedVars = [...preparedVariables].sort((a, b) => {
          if (a.startLine !== b.startLine) return a.startLine - b.startLine
          return a.startColumn - b.startColumn
        })

        const sortedGroups = [...preparedGroups].sort((a, b) => a.startLine - b.startLine)
        const result: string[] = []

        const replaceVariablesInLine = (line: string, lineVars: PreparedVariable[]) => {
          if (lineVars.length === 0) return line

          let modifiedLine = line
          const sortedByCol = [...lineVars].sort((a, b) => b.startColumn - a.startColumn)

          sortedByCol.forEach((v) => {
            const prefix = modifiedLine.substring(0, v.startColumn - 1)
            const suffix = modifiedLine.substring(v.endColumn - 1)
            const filters = [v.pattern, ...(v.indicators || [])].filter(Boolean)

            let replacement = ''
            if (v.syntaxMode === 'ignore') {
              replacement = v.ignoreValue
                ? `{{ ignore("${v.ignoreValue}") }}`
                : '{{ ignore }}'
            } else if (v.syntaxMode === 'headers') {
              const headerFilters = v.headersColumns && v.headersColumns > 0
                ? `_headers_ | columns(${v.headersColumns})`
                : '_headers_'
              replacement = `${v.currentText} {{ ${headerFilters} }}`
            } else if (v.syntaxMode === 'end') {
              replacement = `${v.currentText} {{ _end_ }}`
            } else {
              replacement = filters.length > 0
                ? `{{ ${v.name} | ${filters.join(' | ')} }}`
                : `{{ ${v.name} }}`
            }

            modifiedLine = prefix + replacement + suffix
          })

          return modifiedLine
        }

        const varsByLine = new Map<number, PreparedVariable[]>()
        sortedVars.forEach((v) => {
          const existing = varsByLine.get(v.startLine) || []
          existing.push(v)
          varsByLine.set(v.startLine, existing)
        })

        const groupsStartingByLine = new Map<number, Group[]>()
        const groupsEndingByLine = new Map<number, Group[]>()
        sortedGroups.forEach((g) => {
          const starting = groupsStartingByLine.get(g.startLine) || []
          starting.push(g)
          groupsStartingByLine.set(g.startLine, starting)

          const ending = groupsEndingByLine.get(g.endLine) || []
          ending.push(g)
          groupsEndingByLine.set(g.endLine, ending)
        })

        const lineIsInsideNamedGroup = (lineNum: number) => {
          return sortedGroups.some((group) => lineNum >= group.startLine && lineNum <= group.endLine)
        }

        const rootSegmentLines = new Set<number>()
        if (sortedGroups.length > 0) {
          let segmentStart: number | null = null
          let segmentHasRootVars = false

          for (let lineNum = 1; lineNum <= lines.length; lineNum++) {
            const insideNamedGroup = lineIsInsideNamedGroup(lineNum)
            const hasRootVars = !insideNamedGroup && (varsByLine.get(lineNum)?.length || 0) > 0

            if (!insideNamedGroup) {
              if (segmentStart === null) {
                segmentStart = lineNum
                segmentHasRootVars = false
              }
              if (hasRootVars) {
                segmentHasRootVars = true
              }
            }

            if ((insideNamedGroup || lineNum === lines.length) && segmentStart !== null) {
              const segmentEnd = insideNamedGroup ? lineNum - 1 : lineNum
              if (segmentHasRootVars) {
                for (let i = segmentStart; i <= segmentEnd; i++) {
                  rootSegmentLines.add(i)
                }
              }
              segmentStart = null
              segmentHasRootVars = false
            }
          }
        }

        const openGroups: Group[] = []
        let rootGroupOpen = false

        lines.forEach((line, lineIndex) => {
          const lineNum = lineIndex + 1
          const varsOnLine = varsByLine.get(lineNum) || []
          const groupsStartingHere = groupsStartingByLine.get(lineNum) || []
          const groupsEndingHere = groupsEndingByLine.get(lineNum) || []
          const inRootSegment = rootSegmentLines.has(lineNum)

          if (rootGroupOpen && !inRootSegment) {
            result.push('</group>')
            rootGroupOpen = false
          }

          if (!rootGroupOpen && inRootSegment) {
            result.push('<group name="_">')
            rootGroupOpen = true
          }

          for (const group of groupsStartingHere) {
            result.push(`<group name="${group.name}">`)
            openGroups.push(group)
          }

          result.push(replaceVariablesInLine(line, varsOnLine))

          for (const group of groupsEndingHere) {
            const idx = openGroups.findIndex((openGroup) => openGroup.id === group.id)
            if (idx >= 0) {
              openGroups.splice(idx, 1)
              result.push('</group>')
            }
          }
        })

        if (rootGroupOpen) {
          result.push('</group>')
        }

        while (openGroups.length > 0) {
          openGroups.pop()
          result.push('</group>')
        }

        const generatedTemplate = result.join('\n')
        set({ generatedTemplate })
        return generatedTemplate
      },

      clearVariables: () => set({
        variables: [],
        groups: [],
        generatedTemplate: '',
        templateName: '',
        currentTemplateVendor: DEFAULT_VENDOR,
        currentTemplateCategoryPath: [],
        selectedSavedTemplateId: null
      }),

      newTemplate: () => set({
        sampleText: '',
        variables: [],
        groups: [],
        generatedTemplate: '',
        templateName: '',
        currentTemplateVendor: DEFAULT_VENDOR,
        currentTemplateCategoryPath: [],
        selectedSavedTemplateId: null
      }),

      setCurrentTemplateDirectory: (vendor, categoryPath) => set({
        currentTemplateVendor: vendor.trim() || DEFAULT_VENDOR,
        currentTemplateCategoryPath: normalizeCategoryPath(categoryPath)
      }),

      fetchSavedTemplates: async () => {
        set({ isLoadingTemplates: true })
        try {
          const savedTemplates = await getTemplates()
          const current = get()
          const selectedTemplate = current.selectedSavedTemplateId
            ? savedTemplates.find((template) => template.id === current.selectedSavedTemplateId)
            : null
          set({
            savedTemplates,
            currentTemplateVendor: selectedTemplate?.vendor || current.currentTemplateVendor,
            currentTemplateCategoryPath: selectedTemplate?.categoryPath || current.currentTemplateCategoryPath
          })
        } finally {
          set({ isLoadingTemplates: false })
        }
      },

      fetchTemplateDirectories: async () => {
        set({ isLoadingTemplateDirectories: true })
        try {
          const [vendors, parseCategories, generationCategories] = await Promise.all([
            getVendors(),
            getCategories('parse'),
            getCategories('generation')
          ])
          set({ vendors, parseCategories, generationCategories })
        } finally {
          set({ isLoadingTemplateDirectories: false })
        }
      },

      createVendor: async (name) => {
        await createVendorRequest(name)
        await get().fetchTemplateDirectories()
      },

      renameVendor: async (currentName, nextName) => {
        await renameVendorRequest(currentName, nextName)
        await Promise.all([
          get().fetchTemplateDirectories(),
          get().fetchSavedTemplates(),
          get().fetchGenerationTemplates()
        ])
      },

      deleteVendor: async (name) => {
        await deleteVendorRequest(name)
        await get().fetchTemplateDirectories()
      },

      createCategory: async (templateKind, vendor, name, parentId) => {
        await createCategoryRequest(templateKind, { vendor, name, parentId })
        await get().fetchTemplateDirectories()
      },

      updateCategory: async (templateKind, categoryId, vendor, name, parentId) => {
        await updateCategoryRequest(templateKind, categoryId, { vendor, name, parentId })
        await Promise.all([
          get().fetchTemplateDirectories(),
          templateKind === 'parse' ? get().fetchSavedTemplates() : Promise.resolve(),
          templateKind === 'generation' ? get().fetchGenerationTemplates() : Promise.resolve()
        ])
      },

      deleteCategory: async (templateKind, categoryId) => {
        await deleteCategoryRequest(templateKind, categoryId)
        await get().fetchTemplateDirectories()
      },

      saveTemplate: async (name, description, vendor, categoryPath, source = 'sample') => {
        set({ templateName: name })
        const generatedTemplate = source === 'sample'
          ? get().generateTemplate()
          : get().generatedTemplate
        const state = get()
        const currentSavedTemplate = state.selectedSavedTemplateId
          ? state.savedTemplates.find((template) => template.id === state.selectedSavedTemplateId)
          : null
        const payload = {
          name,
          description: description || currentSavedTemplate?.description || '',
          ...toSavedTemplatePayload({
            sampleText: state.sampleText,
            variables: state.variables,
            groups: state.groups,
            generatedTemplate
          }, vendor, categoryPath)
        }

        let savedTemplateId = state.selectedSavedTemplateId

        if (savedTemplateId) {
          const updatedTemplate = await updateTemplate(savedTemplateId, payload)
          savedTemplateId = updatedTemplate.id
        } else {
          const createdTemplate = await createTemplate(payload)
          savedTemplateId = createdTemplate.id
        }

        await get().fetchSavedTemplates()
        await get().fetchTemplateDirectories()

        set({
          templateName: name,
          currentTemplateVendor: vendor.trim() || DEFAULT_VENDOR,
          currentTemplateCategoryPath: normalizeCategoryPath(categoryPath),
          selectedSavedTemplateId: savedTemplateId
        })
      },

      moveTemplate: async (id, vendor, categoryPath) => {
        const state = get()
        const template = state.savedTemplates.find((item) => item.id === id)
        if (!template) {
          return
        }

        await updateTemplate(id, {
          name: template.name,
          description: template.description,
          vendor: vendor.trim() || DEFAULT_VENDOR,
          categoryPath: normalizeCategoryPath(categoryPath),
          sampleText: template.sampleText,
          variables: template.variables,
          groups: template.groups,
          generatedTemplate: template.generatedTemplate
        })

        await Promise.all([
          get().fetchSavedTemplates(),
          get().fetchTemplateDirectories()
        ])
      },

      loadTemplate: async (id) => {
        const state = get()
        const template = state.savedTemplates.find((savedTemplate) => savedTemplate.id === id)
        if (!template) {
          return
        }

        set({
          sampleText: template.sampleText,
          variables: template.variables as unknown as Variable[],
          groups: (template.groups || []) as unknown as Group[],
          generatedTemplate: template.generatedTemplate,
          templateName: template.name,
          currentTemplateVendor: template.vendor || DEFAULT_VENDOR,
          currentTemplateCategoryPath: template.categoryPath || [],
          selectedSavedTemplateId: template.id
        })
      },

      deleteTemplate: async (id) => {
        await deleteTemplateRequest(id)
        const wasSelected = get().selectedSavedTemplateId === id
        await get().fetchSavedTemplates()

        if (wasSelected) {
          set({
            selectedSavedTemplateId: null,
            currentTemplateVendor: DEFAULT_VENDOR,
            currentTemplateCategoryPath: []
          })
        }
      },

      setBatchUploads: (files) => set({ batchUploads: files }),

      addFile: (file) => {
        set((state) => ({
          files: [...state.files, file]
        }))
      },

      removeFile: (id) => {
        set((state) => {
          const newFiles = state.files.filter((f) => f.id !== id)
          const newSelectedId = state.selectedFileId === id ? null : state.selectedFileId
          const newSelectedTestFileIds = state.selectedTestFileIds === null
            ? null
            : state.selectedTestFileIds.filter((fileId) => fileId !== id)

          return {
            files: newFiles,
            selectedFileId: newSelectedId,
            selectedTestFileIds: newFiles.length === 0 ? null : newSelectedTestFileIds
          }
        })
      },

      selectFile: (id) => set({ selectedFileId: id }),

      setInputText: (text) => set({ inputText: text }),

      setParseResult: (result) => set({ parseResult: result }),
      setFileResults: (results) => set({ fileResults: results, selectedResultIndex: 0 }),
      setSelectedResultIndex: (index) => set({ selectedResultIndex: index }),
      setSelectedTestFileIds: (selectedFileIds) => set((state) => ({
        selectedTestFileIds: typeof selectedFileIds === 'function'
          ? selectedFileIds(state.selectedTestFileIds)
          : selectedFileIds
      })),
      clearFileResults: () => set({ fileResults: [], selectedResultIndex: 0 }),
      setIsParsing: (isParsing) => set({ isParsing }),

      setGenerationTemplateText: (text) => set({ generationTemplateText: text }),
      setGenerationBindings: (bindings) => set((state) => ({
        generationBindings: typeof bindings === 'function'
          ? bindings(state.generationBindings)
          : bindings
      })),
      addGenerationUploadedFile: (file) => set((state) => ({
        generationUploadedFiles: [...state.generationUploadedFiles, file]
      })),
      removeGenerationUploadedFile: (id) => set((state) => {
        const nextFiles = state.generationUploadedFiles.filter((file) => file.id !== id)
        return {
          generationUploadedFiles: nextFiles,
          selectedGenerationFileId: state.selectedGenerationFileId === id ? (nextFiles[0]?.id || null) : state.selectedGenerationFileId
        }
      }),
      setSelectedGenerationFileId: (id) => set({ selectedGenerationFileId: id }),
      clearGenerationUploadedFiles: () => set({ generationUploadedFiles: [], selectedGenerationFileId: null }),
      setSelectedGenerationResultIndex: (index) => set({ selectedGenerationResultIndex: index }),
      setSelectedGenerationTemplateId: (id) => set({ selectedGenerationTemplateId: id }),
      setSelectedGenerationSourceTemplateIds: (ids) => set((state) => ({
        selectedGenerationSourceTemplateIds: typeof ids === 'function' ? ids(state.selectedGenerationSourceTemplateIds) : ids
      })),
      setCurrentGenerationTemplateDirectory: (vendor, categoryPath) => set({
        currentGenerationTemplateVendor: vendor.trim() || DEFAULT_VENDOR,
        currentGenerationTemplateCategoryPath: normalizeCategoryPath(categoryPath)
      }),
      fetchGenerationTemplates: async () => {
        set({ isLoadingGenerationTemplates: true })
        try {
          const generationTemplates = await getGenerationTemplates()
          const current = get()
          const selectedTemplate = current.selectedGenerationTemplateId
            ? generationTemplates.find((template) => template.id === current.selectedGenerationTemplateId)
            : null
          set({
            generationTemplates,
            currentGenerationTemplateVendor: selectedTemplate?.vendor || current.currentGenerationTemplateVendor,
            currentGenerationTemplateCategoryPath: selectedTemplate?.categoryPath || current.currentGenerationTemplateCategoryPath
          })
        } finally {
          set({ isLoadingGenerationTemplates: false })
        }
      },
      saveGenerationTemplate: async (name, description, vendor, categoryPath, sourceTemplates) => {
        const state = get()
        const payload = toGenerationTemplatePayload(state, name, description, vendor, categoryPath, sourceTemplates)

        if (state.selectedGenerationTemplateId) {
          const updatedTemplate = await updateGenerationTemplate(state.selectedGenerationTemplateId, payload)
          set((current) => ({
            generationTemplates: current.generationTemplates.map((template) => (
              template.id === updatedTemplate.id ? updatedTemplate : template
            )),
            selectedGenerationTemplateId: updatedTemplate.id,
            currentGenerationTemplateVendor: updatedTemplate.vendor,
            currentGenerationTemplateCategoryPath: updatedTemplate.categoryPath
          }))
          await get().fetchTemplateDirectories()
          return
        }

        const createdTemplate = await createGenerationTemplate(payload)
        set((current) => ({
          generationTemplates: [...current.generationTemplates, createdTemplate],
          selectedGenerationTemplateId: createdTemplate.id,
          currentGenerationTemplateVendor: createdTemplate.vendor,
          currentGenerationTemplateCategoryPath: createdTemplate.categoryPath
        }))
        await get().fetchTemplateDirectories()
      },
      moveGenerationTemplate: async (id, vendor, categoryPath) => {
        const state = get()
        const template = state.generationTemplates.find((item) => item.id === id)
        if (!template) {
          return
        }

        await updateGenerationTemplate(id, {
          name: template.name,
          description: template.description,
          vendor: vendor.trim() || DEFAULT_VENDOR,
          categoryPath: normalizeCategoryPath(categoryPath),
          templateText: template.templateText,
          sourceTemplates: template.sourceTemplates,
          bindings: template.bindings
        })

        await Promise.all([
          get().fetchGenerationTemplates(),
          get().fetchTemplateDirectories()
        ])
      },
      loadGenerationTemplate: async (id) => {
        const state = get()
        const template = state.generationTemplates.find((generationTemplate) => generationTemplate.id === id)
        if (!template) {
          return
        }

        set({
          generationTemplateText: template.templateText,
          generationBindings: template.bindings,
          currentGenerationTemplateVendor: template.vendor || DEFAULT_VENDOR,
          currentGenerationTemplateCategoryPath: template.categoryPath || [],
          selectedGenerationTemplateId: template.id,
          selectedGenerationSourceTemplateIds: template.sourceTemplates.map((sourceTemplate) => sourceTemplate.templateId)
        })
      },
      deleteGenerationTemplate: async (id) => {
        await deleteGenerationTemplateRequest(id)
        set((state) => ({
          generationTemplates: state.generationTemplates.filter((template) => template.id !== id),
          selectedGenerationTemplateId: state.selectedGenerationTemplateId === id ? null : state.selectedGenerationTemplateId,
          currentGenerationTemplateVendor: state.selectedGenerationTemplateId === id ? DEFAULT_VENDOR : state.currentGenerationTemplateVendor,
          currentGenerationTemplateCategoryPath: state.selectedGenerationTemplateId === id ? [] : state.currentGenerationTemplateCategoryPath
        }))
      },
      runGeneration: async (options) => {
        const state = get()
        const sourceTemplates = buildGenerationSourceTemplates(
          state.savedTemplates,
          state.selectedGenerationSourceTemplateIds
        )
        const selectedTemplate = state.generationTemplates.find(
          (template) => template.id === state.selectedGenerationTemplateId
        )
        const draftTemplate = toGenerationTemplatePayload(
          state,
          options?.name?.trim() || selectedTemplate?.name || 'Unsaved generation template',
          options?.description ?? selectedTemplate?.description ?? '',
          selectedTemplate?.vendor || state.currentGenerationTemplateVendor,
          selectedTemplate?.categoryPath || state.currentGenerationTemplateCategoryPath,
          sourceTemplates
        )

        if (!draftTemplate.templateText.trim() || state.generationUploadedFiles.length === 0) {
          set({ generationResults: [] })
          return
        }

        set({ isGeneratingConfig: true, generationResults: [], selectedGenerationResultIndex: 0 })
        try {
          const results = await renderGenerationFiles(
            draftTemplate,
            state.generationUploadedFiles.map((file) => ({ file: file.file, name: file.name })),
            state.selectedGenerationTemplateId
          )
          set({ generationResults: results, selectedGenerationResultIndex: 0 })
        } catch (error) {
          set({
            generationResults: [{
              fileName: 'Request Error',
              success: false,
              error: error instanceof Error ? error.message : 'Request failed',
              errorType: 'RequestError'
            }],
            selectedGenerationResultIndex: 0
          })
        } finally {
          set({ isGeneratingConfig: false })
        }
      },

      setPatterns: (patterns) => set({ patterns }),

      toggleTheme: () => {
        const newTheme = get().theme === 'dark' ? 'light' : 'dark'
        set({ theme: newTheme })
      },
      setTheme: (theme) => set({ theme }),

      activeTab: 'template',
      setActiveTab: (tab) => set({ activeTab: tab })
    }),
    {
      name: 'ttp-web-storage',
      partialize: (state) => ({
        theme: state.theme,
        sampleText: state.sampleText,
        variables: state.variables,
        groups: state.groups,
        generatedTemplate: state.generatedTemplate,
        templateName: state.templateName,
        currentTemplateVendor: state.currentTemplateVendor,
        currentTemplateCategoryPath: state.currentTemplateCategoryPath,
        selectedSavedTemplateId: state.selectedSavedTemplateId,
        inputText: state.inputText,
        files: state.files,
        selectedFileId: state.selectedFileId,
        fileResults: state.fileResults,
        selectedResultIndex: state.selectedResultIndex,
        selectedTestFileIds: state.selectedTestFileIds,
        generationTemplateText: state.generationTemplateText,
        generationBindings: state.generationBindings,
        currentGenerationTemplateVendor: state.currentGenerationTemplateVendor,
        currentGenerationTemplateCategoryPath: state.currentGenerationTemplateCategoryPath,
        selectedGenerationTemplateId: state.selectedGenerationTemplateId,
        selectedGenerationResultIndex: state.selectedGenerationResultIndex,
        selectedGenerationSourceTemplateIds: state.selectedGenerationSourceTemplateIds
      })
    }
  )
)

export const getVariableColor = (index?: number): string => {
  const normalizedIndex = typeof index === 'number' && Number.isInteger(index)
    ? index
    : 0
  return VARIABLE_COLORS[((normalizedIndex % VARIABLE_COLORS.length) + VARIABLE_COLORS.length) % VARIABLE_COLORS.length]
}
