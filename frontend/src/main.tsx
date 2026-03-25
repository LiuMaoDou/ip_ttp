import React from 'react'
import ReactDOM from 'react-dom/client'
import loader from '@monaco-editor/loader'
import * as monaco from 'monaco-editor'
import App from './App'
import './index.css'

// Force Monaco to load from the local bundle instead of a CDN.
// This avoids Windows/dev-environment issues where the editor stays on the built-in loading state.
loader.config({ monaco })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
