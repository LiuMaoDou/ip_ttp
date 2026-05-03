import Editor, { type BeforeMount, type OnMount } from '@monaco-editor/react'

interface CodeEditorProps {
  value: string
  language?: string
  theme: 'dark' | 'light'
  readOnly?: boolean
  wordWrap?: 'on' | 'off'
  placeholder?: string
  onChange?: (value: string) => void
  onMount?: OnMount
}

const beforeMount: BeforeMount = (monaco) => {
  monaco.editor.defineTheme('ttp-design-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: '8b949e' },
      { token: 'tag', foreground: 'f0883e', fontStyle: 'bold' },
      { token: 'attribute.name', foreground: '79c0ff' },
      { token: 'attribute.value', foreground: 'a5d6ff' },
      { token: 'delimiter', foreground: '6e7681' }
    ],
    colors: {
      'editor.background': '#0d1117',
      'editor.foreground': '#8b949e',
      'editorLineNumber.foreground': '#484f58',
      'editorLineNumber.activeForeground': '#8b949e',
      'editorCursor.foreground': '#58a6ff',
      'editor.selectionBackground': '#388bfd33',
      'editor.lineHighlightBackground': '#161b2266',
      'editorIndentGuide.background1': '#21262d',
      'editorIndentGuide.activeBackground1': '#30363d',
      'scrollbarSlider.background': '#30363d88',
      'scrollbarSlider.hoverBackground': '#484f5888'
    }
  })

  monaco.editor.defineTheme('ttp-design-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: '', foreground: '57606a' },
      { token: 'tag', foreground: 'bc4c00', fontStyle: 'bold' },
      { token: 'attribute.name', foreground: '0969da' },
      { token: 'attribute.value', foreground: '0550ae' }
    ],
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#57606a',
      'editorLineNumber.foreground': '#afb8c1',
      'editorLineNumber.activeForeground': '#57606a',
      'editorCursor.foreground': '#0969da',
      'editor.selectionBackground': '#0969da22',
      'editor.lineHighlightBackground': '#f6f8fa',
      'editorIndentGuide.background1': '#e8ecf0',
      'editorIndentGuide.activeBackground1': '#d0d7de',
      'scrollbarSlider.background': '#d0d7de88',
      'scrollbarSlider.hoverBackground': '#afb8c188'
    }
  })
}

export function CodeEditor({
  value,
  language = 'plaintext',
  theme,
  readOnly = false,
  wordWrap = 'on',
  placeholder,
  onChange,
  onMount
}: CodeEditorProps) {
  const handleMount: OnMount = (editorInstance, monaco) => {
    monaco.editor.setTheme(theme === 'dark' ? 'ttp-design-dark' : 'ttp-design-light')
    onMount?.(editorInstance, monaco)
  }

  return (
    <div className="code-editor-shell">
      <Editor
        height="100%"
        defaultLanguage={language}
        value={value}
        beforeMount={beforeMount}
        onMount={handleMount}
        onChange={(next) => onChange?.(next || '')}
        theme={theme === 'dark' ? 'ttp-design-dark' : 'ttp-design-light'}
        options={{
          readOnly,
          minimap: { enabled: false },
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          lineHeight: 21,
          lineNumbers: 'on',
          lineNumbersMinChars: 3,
          wordWrap,
          automaticLayout: true,
          scrollBeyondLastLine: false,
          renderLineHighlight: readOnly ? 'none' : 'line',
          overviewRulerLanes: 0,
          folding: false,
          glyphMargin: false,
          padding: { top: 10, bottom: 10 },
          scrollbar: {
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
            alwaysConsumeMouseWheel: false
          }
        }}
      />
      {!value.trim() && placeholder && (
        <div className="code-editor-placeholder">
          {placeholder}
        </div>
      )}
    </div>
  )
}

export type { OnMount }
