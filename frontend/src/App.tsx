import { useEffect, useState } from 'react'
import { TemplateBuilder, TestResults } from './components'
import { useStore } from './store/useStore'
import { getPatterns } from './services/api'

type Tab = 'template' | 'test'

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('template')
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [backendStatus, setBackendStatus] = useState<'checking' | 'connected' | 'error'>('checking')

  const { setPatterns, fetchSavedTemplates, theme, toggleTheme } = useStore()

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Load patterns and saved templates on mount
  useEffect(() => {
    const loadAppData = async () => {
      try {
        const patterns = await getPatterns()
        setPatterns(patterns)
        await fetchSavedTemplates()
        setBackendStatus('connected')
      } catch (error) {
        console.error('Failed to load app data:', error)
        setBackendStatus('error')
      }
    }
    void loadAppData()
  }, [fetchSavedTemplates, setPatterns])

  const tabs: { id: Tab; label: string; icon: JSX.Element }[] = [
    {
      id: 'template',
      label: 'Template Builder',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
        </svg>
      )
    },
    {
      id: 'test',
      label: 'Test & Results',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
      )
    }
  ]

  return (
    <div className="h-screen flex flex-col" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      {/* Header */}
      <header className="px-4 py-3 border-b" style={{ backgroundColor: 'var(--bg-header)', borderColor: 'var(--border-color)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>TTP Web</h1>
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Template Text Parser</span>
          </div>

          <div className="flex items-center gap-4">
            {/* Theme Toggle Button */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg transition-colors hover:opacity-80"
              style={{ backgroundColor: 'var(--bg-tertiary)' }}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--text-primary)' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--text-primary)' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>

            {/* Backend status indicator */}
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${
                backendStatus === 'checking' ? 'bg-yellow-500 animate-pulse' :
                backendStatus === 'connected' ? 'bg-green-500' :
                'bg-red-500'
              }`} />
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                {backendStatus === 'checking' ? 'Connecting...' :
                 backendStatus === 'connected' ? 'Backend connected' :
                 'Backend offline'}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Desktop tabs */}
      <nav className="border-b hidden md:flex" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
        <div className="flex">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-2 px-6 py-3 text-sm font-medium transition-colors"
              style={{
                color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                backgroundColor: activeTab === tab.id ? 'var(--bg-tertiary)' : 'transparent',
                borderBottom: activeTab === tab.id ? '2px solid var(--accent-primary)' : '2px solid transparent'
              }}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Mobile menu button */}
      <div className="md:hidden border-b p-2" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="flex items-center gap-2 px-4 py-2"
          style={{ color: 'var(--text-primary)' }}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          <span>{tabs.find(t => t.id === activeTab)?.label}</span>
        </button>
      </div>

      {/* Mobile menu */}
      {isMobileMenuOpen && (
        <div className="md:hidden border-b" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id)
                setIsMobileMenuOpen(false)
              }}
              className="flex items-center gap-2 w-full px-4 py-3 text-left"
              style={{
                color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                backgroundColor: activeTab === tab.id ? 'var(--bg-tertiary)' : 'transparent'
              }}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        {activeTab === 'template' && <TemplateBuilder />}
        {activeTab === 'test' && <TestResults />}
      </main>

      {/* Footer */}
      <footer className="px-4 py-2 text-center text-xs border-t" style={{ backgroundColor: 'var(--bg-header)', borderColor: 'var(--border-color)', color: 'var(--text-muted)' }}>
        TTP Web - Interactive Template Text Parser |{' '}
        <a
          href="https://github.com/dmulyalin/ttp"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--accent-primary)' }}
          className="hover:opacity-80"
        >
          GitHub
        </a>
      </footer>
    </div>
  )
}
