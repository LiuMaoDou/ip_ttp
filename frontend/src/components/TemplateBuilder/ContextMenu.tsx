interface ContextMenuProps {
  x: number
  y: number
  selectedText: string
  onAddVariable: () => void
  onAddGroup: () => void
  onClose: () => void
}

export default function ContextMenu({ x, y, selectedText, onAddVariable, onAddGroup, onClose }: ContextMenuProps) {
  const previewText = selectedText.replace(/\s+/g, ' ').trim()

  return (
    <>
      <div className="sample-context-backdrop" onClick={onClose} />
      <div
        className="sample-context-menu"
        style={{ left: x, top: y }}
        onContextMenu={(event) => event.preventDefault()}
        onClick={(event) => event.stopPropagation()}
        >
        <div className="sample-context-selected">
          <div className="sample-context-selected-label">已选中：</div>
          <div className="sample-context-selected-text" title={selectedText}>
            "{previewText}"
          </div>
        </div>
        <button
          type="button"
          onClick={onAddVariable}
          className="sample-context-item"
        >
          <span className="sample-context-icon sample-context-icon-variable" />
          <span>添加为变量</span>
        </button>
        <button
          type="button"
          onClick={onAddGroup}
          className="sample-context-item"
        >
          <span className="sample-context-icon sample-context-icon-group" />
          <span>添加为组</span>
        </button>
      </div>
    </>
  )
}
