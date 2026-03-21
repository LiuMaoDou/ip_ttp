import type { editor } from 'monaco-editor'

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export function sanitizeFileNameSegment(value: string): string {
  return value.replace(/[<>:"/\\|?*\s]+/g, '_').replace(/^_+|_+$/g, '')
}

export function getParameterPlaceholderDecorations(
  monaco: typeof import('monaco-editor'),
  model: editor.ITextModel
): editor.IModelDeltaDecoration[] {
  return Array.from(model.getValue().matchAll(/\{\{[^{}]+\}\}/g)).map((match) => {
    const startOffset = match.index ?? 0
    const endOffset = startOffset + match[0].length
    const startPosition = model.getPositionAt(startOffset)
    const endPosition = model.getPositionAt(endOffset)

    return {
      range: new monaco.Range(
        startPosition.lineNumber,
        startPosition.column,
        endPosition.lineNumber,
        endPosition.column
      ),
      options: {
        inlineClassName: 'template-parameter-highlight',
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
      }
    }
  })
}
