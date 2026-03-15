import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type VariableSyntaxMode = 'variable' | 'ignore' | 'headers' | 'end'

// Variable definition for template builder
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

// Group definition for template builder
export interface Group {
  id: string
  name: string
  startLine: number
  endLine: number
  colorIndex: number
}

// Uploaded file
export interface UploadedFile {
  id: string
  name: string
  size: number
  content: string
}

// Parse result
export interface ParseResult {
  success: boolean
  result?: unknown
  csvResult?: string
  error?: string
  errorType?: string
}

// File parse result for multi-file parsing
export interface FileParseResult {
  fileId: string
  fileName: string
  templateId?: string
  templateName?: string
  result: unknown
  csvResult?: string
  success: boolean
  error?: string
  errorType?: string
}

// Pattern definition
export interface Pattern {
  regex: string
  description: string
}

// Saved template
export interface SavedTemplate {
  id: string
  name: string
  description: string
  sampleText: string
  variables: Variable[]
  groups: Group[]
  generatedTemplate: string
  createdAt: number
}

interface AppState {
  // Theme
  theme: 'light' | 'dark'

  // Template Builder
  sampleText: string
  variables: Variable[]
  groups: Group[]
  generatedTemplate: string
  templateName: string

  // Saved Templates
  savedTemplates: SavedTemplate[]

  // File Input
  files: UploadedFile[]
  selectedFileId: string | null
  inputText: string

  // Test Results
  parseResult: ParseResult | null
  fileResults: FileParseResult[]
  selectedResultIndex: number
  selectedTestFileIds: string[] | null
  isParsing: boolean

  // Patterns from backend
  patterns: Record<string, Pattern>

  // Actions - Template Builder
  setSampleText: (text: string) => void
  addVariable: (variable: Omit<Variable, 'id' | 'colorIndex'>) => void
  removeVariable: (id: string) => void
  updateVariable: (id: string, updates: Partial<Variable>) => void
  addGroup: (group: Omit<Group, 'id' | 'colorIndex'>) => void
  removeGroup: (id: string) => void
  setTemplateName: (name: string) => void
  generateTemplate: () => void
  clearVariables: () => void

  // Actions - Saved Templates
  saveTemplate: (name: string, description: string) => void
  loadTemplate: (id: string) => void
  deleteTemplate: (id: string) => void

  // Actions - File Input
  addFile: (file: UploadedFile) => void
  removeFile: (id: string) => void
  selectFile: (id: string | null) => void
  setInputText: (text: string) => void

  // Actions - Test Results
  setParseResult: (result: ParseResult | null) => void
  setFileResults: (results: FileParseResult[]) => void
  setSelectedResultIndex: (index: number) => void
  setSelectedTestFileIds: (selectedFileIds: string[] | null | ((current: string[] | null) => string[] | null)) => void
  clearFileResults: () => void
  setIsParsing: (isParsing: boolean) => void

  // Actions - Patterns
  setPatterns: (patterns: Record<string, Pattern>) => void

  // Actions - Theme
  toggleTheme: () => void
  setTheme: (theme: 'light' | 'dark') => void
}

// Color palette for variables (12 colors)
const VARIABLE_COLORS = [
  '#3b82f6', '#22c55e', '#a855f7', '#f59e0b', '#ef4444', '#06b6d4',
  '#ec4899', '#84cc16', '#6366f1', '#14b8a6', '#f97316', '#8b5cf6'
]

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Initial state
      theme: 'dark',
      sampleText: '',
      variables: [],
      groups: [],
      generatedTemplate: '',
      templateName: '',
      savedTemplates: [],
      files: [],
      selectedFileId: null,
      inputText: '',
      parseResult: null,
      fileResults: [],
      selectedResultIndex: 0,
      selectedTestFileIds: null,
      isParsing: false,
      patterns: {},

      // Template Builder Actions
      setSampleText: (text) => set({ sampleText: text }),

      addVariable: (variable) => {
        const state = get()
        const colorIndex = state.variables.length % VARIABLE_COLORS.length
        const newVariable: Variable = {
          ...variable,
          id: `var-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
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

      addGroup: (group) => {
        const state = get()
        const colorIndex = state.groups.length % VARIABLE_COLORS.length
        const newGroup: Group = {
          ...group,
          id: `grp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          colorIndex
        }
        set({ groups: [...state.groups, newGroup] })
      },

      removeGroup: (id) => {
        set((state) => ({
          groups: state.groups.filter((g) => g.id !== id)
        }))
      },

      setTemplateName: (name) => set({ templateName: name }),

      generateTemplate: () => {
        const state = get()
        const { sampleText, variables, groups } = state

        console.log('generateTemplate called with:', { variables: variables.length, groupsCount: groups.length, groups })

        if (variables.length === 0 && groups.length === 0) {
          set({ generatedTemplate: sampleText })
          return
        }

        const sortedVars = [...variables].sort((a, b) => {
          if (a.startLine !== b.startLine) return a.startLine - b.startLine
          return a.startColumn - b.startColumn
        })

        const sortedGroups = [...groups].sort((a, b) => a.startLine - b.startLine)
        const lines = sampleText.split('\n')
        const result: string[] = []

        const replaceVariablesInLine = (line: string, lineVars: Variable[]) => {
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
              replacement = `${v.originalText} {{ ${headerFilters} }}`
            } else if (v.syntaxMode === 'end') {
              replacement = `${v.originalText} {{ _end_ }}`
            } else {
              replacement = filters.length > 0
                ? `{{ ${v.name} | ${filters.join(' | ')} }}`
                : `{{ ${v.name} }}`
            }

            modifiedLine = prefix + replacement + suffix
          })

          return modifiedLine
        }

        const varsByLine = new Map<number, Variable[]>()
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
          return sortedGroups.some(g => lineNum >= g.startLine && lineNum <= g.endLine)
        }

        const rootSegmentLines = new Set<number>()
        if (sortedGroups.length > 0) {
          let segmentStart: number | null = null
          let segmentHasRootVars = false

          for (let lineNum = 1; lineNum <= lines.length; lineNum++) {
            const insideNamedGroup = lineIsInsideNamedGroup(lineNum)
            const hasRootVars = (varsByLine.get(lineNum) || []).some(v => !lineIsInsideNamedGroup(v.startLine))

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
            const idx = openGroups.findIndex(g => g.id === group.id)
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
        console.log('Generated template:', generatedTemplate)
        set({ generatedTemplate })
      },

      clearVariables: () => set({ variables: [], groups: [], generatedTemplate: '', templateName: '' }),

      // Saved Templates Actions
      saveTemplate: (name, description) => {
        const state = get()
        const existingIndex = state.savedTemplates.findIndex(t => t.name === name)

        if (existingIndex >= 0) {
          // Update existing template
          const updatedTemplates = [...state.savedTemplates]
          updatedTemplates[existingIndex] = {
            ...updatedTemplates[existingIndex],
            description: description || updatedTemplates[existingIndex].description,
            sampleText: state.sampleText,
            variables: state.variables,
            groups: state.groups,
            generatedTemplate: state.generatedTemplate,
            createdAt: Date.now()
          }
          set({ savedTemplates: updatedTemplates })
        } else {
          // Create new template
          const newTemplate: SavedTemplate = {
            id: `tpl-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name,
            description,
            sampleText: state.sampleText,
            variables: state.variables,
            groups: state.groups,
            generatedTemplate: state.generatedTemplate,
            createdAt: Date.now()
          }
          set({ savedTemplates: [...state.savedTemplates, newTemplate] })
        }
      },

      loadTemplate: (id) => {
        const state = get()
        const template = state.savedTemplates.find(t => t.id === id)
        if (template) {
          set({
            sampleText: template.sampleText,
            variables: template.variables,
            groups: template.groups || [],
            generatedTemplate: template.generatedTemplate,
            templateName: template.name
          })
          // Always regenerate template after loading to ensure it's up to date
          // This handles cases where template was saved without generating
          get().generateTemplate()
        }
      },

      deleteTemplate: (id) => {
        set((state) => ({
          savedTemplates: state.savedTemplates.filter(t => t.id !== id)
        }))
      },

      // File Input Actions
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

      // Test Results Actions
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

      // Patterns Actions
      setPatterns: (patterns) => set({ patterns }),

      // Theme Actions
      toggleTheme: () => {
        const newTheme = get().theme === 'dark' ? 'light' : 'dark'
        set({ theme: newTheme })
      },
      setTheme: (theme) => set({ theme })
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
        savedTemplates: state.savedTemplates,
        inputText: state.inputText,
        files: state.files,
        selectedFileId: state.selectedFileId,
        fileResults: state.fileResults,
        selectedResultIndex: state.selectedResultIndex,
        selectedTestFileIds: state.selectedTestFileIds
      })
    }
  )
)

// Export colors for components
export const getVariableColor = (index: number): string => {
  return VARIABLE_COLORS[index % VARIABLE_COLORS.length]
}
