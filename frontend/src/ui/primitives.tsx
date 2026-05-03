import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger' | 'success'
type ButtonSize = 'xs' | 'sm' | 'md'

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Btn({ children, variant = 'default', size = 'sm', className = '', ...props }: BtnProps) {
  return (
    <button {...props} className={`ui-btn ui-btn-${variant} ui-btn-${size} ${className}`}>
      {children}
    </button>
  )
}

export function Tag({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'green' | 'red' | 'orange' | 'purple' }) {
  return <span className={`ui-tag ui-tag-${tone}`}>{children}</span>
}

export function StatusDot({ status }: { status: 'checking' | 'connected' | 'error' }) {
  const label = status === 'connected' ? '已连接' : status === 'checking' ? '连接中...' : '离线'
  return (
    <span className={`ui-status ui-status-${status}`}>
      <span />
      {label}
    </span>
  )
}

export function PanelHeader({
  title,
  subtitle,
  actions,
  compact = false
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  compact?: boolean
}) {
  return (
    <div className={`panel-header ${compact ? 'panel-header-compact' : ''}`}>
      <div className="panel-header-copy">
        <span>{title}</span>
        {subtitle && <small>{subtitle}</small>}
      </div>
      {actions && <div className="panel-header-actions">{actions}</div>}
    </div>
  )
}

export function Modal({
  title,
  subtitle,
  width = 440,
  children,
  onClose
}: {
  title: string
  subtitle?: ReactNode
  width?: number
  children: ReactNode
  onClose: () => void
}) {
  return (
    <div className="ui-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="ui-modal" style={{ width, maxWidth: '94vw' }}>
        <div className="ui-modal-head">
          <div>
            <h3>{title}</h3>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="ui-icon-btn" onClick={onClose} aria-label="Close">x</button>
        </div>
        <div className="ui-modal-body">{children}</div>
      </div>
    </div>
  )
}

export function FormField({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="form-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  )
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`ui-input ${props.className || ''}`} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`ui-input ${props.className || ''}`} />
}

export function ProgressBar({
  percent,
  label,
  detail,
  tone = 'accent'
}: {
  percent: number
  label: string
  detail?: string
  tone?: 'accent' | 'green' | 'red' | 'orange'
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)))
  return (
    <div className="progress-card">
      <div className="progress-head">
        <strong>{label}</strong>
        {detail && <span>{detail}</span>}
        <code>{clamped}%</code>
      </div>
      <div className="progress-track">
        <div className={`progress-fill progress-fill-${tone}`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  )
}

export function FileIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  )
}

export function CodeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
    </svg>
  )
}
