interface ContextMenuProps {
  x: number
  y: number
  selectedText: string
  onAddVariable: () => void
  onClose: () => void
}

export default function ContextMenu({ x, y, selectedText, onAddVariable, onClose }: ContextMenuProps) {
  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Menu */}
      <div
        className="fixed z-50 bg-gray-800 border border-gray-600 rounded-lg shadow-xl py-1 min-w-[200px]"
        style={{ left: x, top: y }}
      >
        <button
          onClick={onAddVariable}
          className="w-full px-4 py-2 text-left text-sm hover:bg-gray-700 flex items-center gap-2"
        >
          <span className="text-blue-400">+</span>
          <span>Add as Variable</span>
        </button>
        <div className="border-t border-gray-700 my-1" />
        <div className="px-4 py-2 text-xs text-gray-400">
          Selected: <span className="text-white">{selectedText.substring(0, 30)}{selectedText.length > 30 ? '...' : ''}</span>
        </div>
      </div>
    </>
  )
}
