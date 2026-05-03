import { useEffect, useState } from 'react'
import { ConfigGeneration, TemplateBuilder, TestResults } from './components'
import { CodeIcon, StatusDot } from './ui/primitives'
import { getPatterns } from './services/api'
import { useStore } from './store/useStore'

type Tab = 'template' | 'test' | 'config'
type BackendStatus = 'checking' | 'connected' | 'error'

function TestIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
      <path d="M9 5a2 2 0 002 2h2a2 2 0 002-2m-6 9l2 2 4-4" />
    </svg>
  )
}

function ConfigIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  )
}

function ThemeIcon({ theme }: { theme: 'dark' | 'light' }) {
  return theme === 'dark' ? (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="5" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2" />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  )
}

function GithubIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  )
}

export default function App() {
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('checking')
  const {
    activeTab,
    setActiveTab,
    theme,
    toggleTheme,
    setPatterns,
    fetchSavedTemplates,
    fetchTemplateDirectories,
    fetchGenerationTemplates
  } = useStore()

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    const load = async () => {
      try {
        const [patterns] = await Promise.all([
          getPatterns(),
          fetchTemplateDirectories(),
          fetchSavedTemplates(),
          fetchGenerationTemplates()
        ])
        setPatterns(patterns)
        setBackendStatus('connected')
      } catch (error) {
        console.error(error)
        setBackendStatus('error')
      }
    }
    void load()
  }, [fetchGenerationTemplates, fetchSavedTemplates, fetchTemplateDirectories, setPatterns])

  const tabs: Array<{ id: Tab; label: string; icon: JSX.Element }> = [
    { id: 'template', label: '模板构建', icon: <CodeIcon /> },
    { id: 'test', label: '测试 & 结果', icon: <TestIcon /> },
    { id: 'config', label: '配置生成', icon: <ConfigIcon /> }
  ]

  return (
    <div className="prototype-shell">
      <header className="top-nav">
        <div className="top-left">
          <div className="brand-block">
            <div className="brand-mark"><CodeIcon /></div>
            <div className="brand-copy">
              <strong>mini-IPMaster</strong>
              <span>TTP 解析工作台</span>
            </div>
          </div>
          <nav className="top-tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`top-tab ${activeTab === tab.id ? 'is-active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="top-actions">
          <StatusDot status={backendStatus} />
          <button type="button" className="top-icon-button" onClick={toggleTheme} title="切换明暗主题">
            <ThemeIcon theme={theme} />
          </button>
          <a className="top-icon-button" href="https://github.com/LiuMaoDou/ip_ttp" target="_blank" rel="noreferrer" title="GitHub">
            <GithubIcon />
          </a>
        </div>
      </header>
      <main className="prototype-content">
        <section className="prototype-tab" style={{ display: activeTab === 'template' ? 'block' : 'none' }}>
          <TemplateBuilder />
        </section>
        <section className="prototype-tab" style={{ display: activeTab === 'test' ? 'block' : 'none' }}>
          <TestResults />
        </section>
        <section className="prototype-tab" style={{ display: activeTab === 'config' ? 'block' : 'none' }}>
          <ConfigGeneration />
        </section>
      </main>
    </div>
  )
}
