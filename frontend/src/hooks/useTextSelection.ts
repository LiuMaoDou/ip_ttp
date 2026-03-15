import { useCallback, useState } from 'react'
import type { editor } from 'monaco-editor'

export interface TextSelection {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
  selectedText: string
}

export function useTextSelection() {
  const [selection, setSelection] = useState<TextSelection | null>(null)
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null)

  const handleSelection = useCallback(
    (editorInstance: editor.IStandaloneCodeEditor, event: React.MouseEvent) => {
      const sel = editorInstance.getSelection()
      if (!sel) return

      const model = editorInstance.getModel()
      if (!model) return

      const selectedText = model.getValueInRange(sel)

      // Only proceed if there's actual selection
      if (!selectedText.trim()) {
        setSelection(null)
        setMenuPosition(null)
        return
      }

      // Normalize selection (ensure start < end)
      const startLineNumber = sel.startLineNumber
      const startColumn = sel.startColumn
      const endLineNumber = sel.endLineNumber
      const endColumn = sel.endColumn

      setSelection({
        startLineNumber,
        startColumn,
        endLineNumber,
        endColumn,
        selectedText
      })

      // Position the context menu
      setMenuPosition({
        x: event.clientX,
        y: event.clientY
      })
    },
    []
  )

  const clearSelection = useCallback(() => {
    setSelection(null)
    setMenuPosition(null)
  }, [])

  return {
    selection,
    menuPosition,
    handleSelection,
    clearSelection
  }
}
