import { useCallback, useEffect, useRef } from 'react'
import { useDropzone } from 'react-dropzone'
import Editor, { OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { useStore, UploadedFile } from '../../store/useStore'
import { formatFileSize } from '../../utils'

export default function FileInput() {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)

  const {
    files,
    addFile,
    removeFile,
    selectedFileId,
    selectFile,
    inputText,
    setInputText,
    theme
  } = useStore()

  const onDrop = useCallback((acceptedFiles: File[]) => {
    // Process each file
    acceptedFiles.forEach((file, index) => {
      const reader = new FileReader()
      reader.onload = () => {
        const content = reader.result as string
        const newFile: UploadedFile = {
          id: `file-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 9)}`,
          name: file.name,
          size: file.size,
          content
        }
        addFile(newFile)
        // Only select and display the first file
        if (index === 0) {
          selectFile(newFile.id)
          setInputText(content)
        }
      }
      reader.readAsText(file)
    })
  }, [addFile, selectFile, setInputText])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/*': ['.txt', '.log', '.cfg', '.conf', '.json', '.xml', '.yaml', '.yml'],
      'application/*': ['.cfg', '.conf']
    },
    multiple: true
  })

  const handleEditorMount: OnMount = (editorInstance, monaco) => {
    editorRef.current = editorInstance
    monacoRef.current = monaco

    monaco.editor.defineTheme('ttp-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: { 'editor.background': '#1e1e2e' }
    })

    monaco.editor.defineTheme('ttp-light', {
      base: 'vs',
      inherit: true,
      rules: [],
      colors: { 'editor.background': '#ffffff' }
    })

    monaco.editor.setTheme(theme === 'dark' ? 'ttp-dark' : 'ttp-light')
  }

  useEffect(() => {
    if (monacoRef.current) {
      monacoRef.current.editor.setTheme(theme === 'dark' ? 'ttp-dark' : 'ttp-light')
    }
  }, [theme])

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Header */}
      <div className="page-header">
        <h2>File Input</h2>
        {files.length > 0 && (
          <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{files.length} file(s)</span>
        )}
      </div>

      <div className="flex-1 flex">
        {/* File list sidebar */}
        <div className="w-64 border-r overflow-auto" style={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
          {/* Dropzone */}
          <div
            {...getRootProps()}
            className="p-4 m-2 border-2 border-dashed rounded-lg cursor-pointer transition-colors"
            style={{
              borderColor: isDragActive ? '#3b82f6' : 'var(--border-color)',
              backgroundColor: isDragActive ? 'rgba(59, 130, 246, 0.1)' : 'transparent'
            }}
          >
            <input {...getInputProps()} />
            <div className="text-center">
              <svg className="w-8 h-8 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--text-muted)' }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {isDragActive ? 'Drop files here' : 'Drop files or click'}
              </p>
            </div>
          </div>

          {/* File list */}
          <div className="p-2 space-y-1">
            {files.map((file) => (
              <div
                key={file.id}
                onClick={() => {
                  selectFile(file.id)
                  setInputText(file.content)
                }}
                className="p-2 rounded-md cursor-pointer group transition-colors"
                style={{
                  backgroundColor: selectedFileId === file.id ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                  border: selectedFileId === file.id ? '1px solid rgba(59, 130, 246, 0.5)' : '1px solid transparent'
                }}
                onMouseEnter={(e) => {
                  if (selectedFileId !== file.id) {
                    e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (selectedFileId !== file.id) {
                    e.currentTarget.style.backgroundColor = 'transparent'
                  }
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{file.name}</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatFileSize(file.size)}</p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      removeFile(file.id)
                      if (selectedFileId === file.id) {
                        setInputText('')
                      }
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity ml-2"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Preview area */}
        <div className="flex-1 relative">
          {selectedFileId || inputText ? (
            <Editor
              height="100%"
              defaultLanguage="plaintext"
              value={inputText}
              onChange={(value) => setInputText(value || '')}
              onMount={handleEditorMount}
              options={{
                minimap: { enabled: false },
                lineNumbers: 'on',
                wordWrap: 'on',
                fontSize: 14,
                fontFamily: 'var(--font-mono)',
                scrollBeyondLastLine: false,
                readOnly: false,
                automaticLayout: true
              }}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center p-8" style={{ color: 'var(--text-muted)' }}>
                <svg className="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--text-muted)' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-lg mb-2">No file selected</p>
                <p className="text-sm">Upload files using the dropzone or paste text directly</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
