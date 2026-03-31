import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { TemplateCategory, VendorRecord } from '../services/api'

interface DirectoryTemplate {
  id: string
  name: string
  description?: string
  vendor: string
  categoryPath: string[]
}

interface TemplateDirectoryTreeProps<TTemplate extends DirectoryTemplate> {
  title: string
  vendors: VendorRecord[]
  categories: TemplateCategory[]
  templates: TTemplate[]
  loading?: boolean
  emptyText: string
  activeTemplateId?: string | null
  selectedTemplateIds?: string[]
  multiSelect?: boolean
  manageDirectories?: boolean
  onTemplateClick?: (templateId: string) => void
  onTemplateToggle?: (templateId: string) => void
  onMoveTemplate?: (templateId: string, vendor: string, categoryPath: string[]) => Promise<void>
  onDeleteTemplate?: (templateId: string) => void
  onCreateVendor?: (name: string) => Promise<void>
  onRenameVendor?: (currentName: string, nextName: string) => Promise<void>
  onDeleteVendor?: (name: string) => Promise<void>
  onCreateCategory?: (vendor: string, name: string, parentId?: string | null) => Promise<void>
  onRenameCategory?: (categoryId: string, vendor: string, name: string, parentId?: string | null) => Promise<void>
  onDeleteCategory?: (categoryId: string) => Promise<void>
  renderTemplateMeta?: (template: TTemplate) => ReactNode
}

interface CategoryNode extends TemplateCategory {
  children: CategoryNode[]
}

function joinPath(segments: string[]): string {
  return segments.join('/')
}

function FolderIcon() {
  return (
    <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 7.5A1.5 1.5 0 014.5 6h4.379a1.5 1.5 0 011.06.44l1.122 1.12a1.5 1.5 0 001.06.44H19.5A1.5 1.5 0 0121 9.5v8A2.5 2.5 0 0118.5 20h-13A2.5 2.5 0 013 17.5v-10z" />
    </svg>
  )
}

function TemplateIcon() {
  return (
    <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 3.75h7.879a2 2 0 011.414.586l2.371 2.371A2 2 0 0119.25 8.12V18.25A2.75 2.75 0 0116.5 21h-9A2.75 2.75 0 014.75 18.25v-11.75A2.75 2.75 0 017.5 3.75z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 11h6M9 15h4.5" />
    </svg>
  )
}

function VendorIcon() {
  return (
    <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4.75 20.25h14.5M6.25 20.25V7.5l5.75-3.75 5.75 3.75v12.75M9.25 10.5h.01M14.75 10.5h.01M9.25 14.5h.01M14.75 14.5h.01" />
    </svg>
  )
}

function AddIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14M5 12h14" />
    </svg>
  )
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d={expanded ? 'M6 15l6-6 6 6' : 'M9 6l6 6-6 6'}
      />
    </svg>
  )
}

function ActionMenuIcon({ active }: { active: boolean }) {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <circle cx="7" cy="10" r="1.7" fill="currentColor" stroke="none" opacity={active ? 1 : 0.92} />
      <circle cx="12" cy="10" r="1.7" fill="currentColor" stroke="none" opacity={active ? 1 : 0.92} />
      <circle cx="17" cy="10" r="1.7" fill="currentColor" stroke="none" opacity={active ? 1 : 0.92} />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.9}
        d="M9 14.5l3 3 3-3"
        opacity={active ? 1 : 0.75}
      />
    </svg>
  )
}

function IconButton({
  title,
  color,
  onClick,
  children
}: {
  title: string
  color: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className="inline-flex items-center justify-center w-5 h-5 rounded transition-colors"
      style={{ color }}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
    >
      {children}
    </button>
  )
}

interface ActionMenuItem {
  key: string
  label: string
  color?: string
  onSelect: () => Promise<void> | void
}

export default function TemplateDirectoryTree<TTemplate extends DirectoryTemplate>({
  title,
  vendors,
  categories,
  templates,
  loading = false,
  emptyText,
  activeTemplateId = null,
  selectedTemplateIds = [],
  multiSelect = false,
  manageDirectories = false,
  onTemplateClick,
  onTemplateToggle,
  onMoveTemplate,
  onDeleteTemplate,
  onCreateVendor,
  onRenameVendor,
  onDeleteVendor,
  onCreateCategory,
  onRenameCategory,
  onDeleteCategory,
  renderTemplateMeta
}: TemplateDirectoryTreeProps<TTemplate>) {
  const [moveTarget, setMoveTarget] = useState<TTemplate | null>(null)
  const [moveVendor, setMoveVendor] = useState('')
  const [moveCategoryPath, setMoveCategoryPath] = useState('')
  const [collapsedVendors, setCollapsedVendors] = useState<Record<string, boolean>>({})
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({})
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null)

  useEffect(() => {
    const handleWindowClick = () => {
      setOpenMenuKey(null)
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenMenuKey(null)
      }
    }

    window.addEventListener('click', handleWindowClick)
    window.addEventListener('keydown', handleEscape)

    return () => {
      window.removeEventListener('click', handleWindowClick)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [])

  const vendorNames = Array.from(new Set([
    ...vendors.map((vendor) => vendor.name),
    ...categories.map((category) => category.vendor),
    ...templates.map((template) => template.vendor)
  ])).sort((left, right) => left.localeCompare(right))

  const categoriesByVendor = new Map<string, TemplateCategory[]>()
  categories.forEach((category) => {
    const existing = categoriesByVendor.get(category.vendor) || []
    existing.push(category)
    categoriesByVendor.set(category.vendor, existing)
  })

  const templatesByVendor = new Map<string, TTemplate[]>()
  templates.forEach((template) => {
    const existing = templatesByVendor.get(template.vendor) || []
    existing.push(template)
    templatesByVendor.set(template.vendor, existing)
  })

  const findCategoryByPath = (vendor: string, path: string[]): TemplateCategory | undefined => {
    return categories.find((category) => category.vendor === vendor && joinPath(category.path) === joinPath(path))
  }

  const moveCategoryOptions = useMemo(() => {
    if (!moveVendor) {
      return []
    }
    return categories
      .filter((category) => category.vendor === moveVendor)
      .map((category) => joinPath(category.path))
      .sort((left, right) => left.localeCompare(right))
  }, [categories, moveVendor])

  const buildCategoryTree = (vendor: string): CategoryNode[] => {
    const vendorCategories = categoriesByVendor.get(vendor) || []
    const nodeMap = new Map<string, CategoryNode>()
    vendorCategories.forEach((category) => {
      nodeMap.set(category.id, { ...category, children: [] })
    })

    const roots: CategoryNode[] = []
    nodeMap.forEach((category) => {
      if (category.parentId && nodeMap.has(category.parentId)) {
        nodeMap.get(category.parentId)!.children.push(category)
      } else {
        roots.push(category)
      }
    })

    const sortNodes = (nodes: CategoryNode[]) => {
      nodes.sort((left, right) => left.name.localeCompare(right.name))
      nodes.forEach((node) => sortNodes(node.children))
    }
    sortNodes(roots)
    return roots
  }

  const handlePromptCreateVendor = async () => {
    const name = window.prompt('Vendor name')
    if (!name?.trim() || !onCreateVendor) {
      return
    }
    await onCreateVendor(name.trim())
  }

  const handlePromptRenameVendor = async (vendor: string) => {
    const nextName = window.prompt('Rename vendor', vendor)
    if (!nextName?.trim() || nextName.trim() === vendor || !onRenameVendor) {
      return
    }
    await onRenameVendor(vendor, nextName.trim())
  }

  const handlePromptDeleteVendor = async (vendor: string) => {
    if (!onDeleteVendor || !window.confirm(`Delete vendor "${vendor}"?`)) {
      return
    }
    await onDeleteVendor(vendor)
  }

  const handlePromptCreateCategory = async (vendor: string, parentId?: string | null) => {
    const name = window.prompt('Folder name')
    if (!name?.trim() || !onCreateCategory) {
      return
    }
    await onCreateCategory(vendor, name.trim(), parentId)
  }

  const handlePromptRenameCategory = async (category: TemplateCategory) => {
    const nextName = window.prompt('Rename folder', category.name)
    if (!nextName?.trim() || nextName.trim() === category.name || !onRenameCategory) {
      return
    }
    await onRenameCategory(category.id, category.vendor, nextName.trim(), category.parentId)
  }

  const handlePromptMoveCategory = async (category: TemplateCategory) => {
    if (!onRenameCategory) {
      return
    }
    const currentTarget = [category.vendor, ...category.path.slice(0, -1)].join('/')
    const destination = window.prompt('Move folder to vendor/path (example: Huawei/Core)', currentTarget)
    if (destination === null) {
      return
    }
    const segments = destination.split('/').map((segment) => segment.trim()).filter(Boolean)
    if (segments.length === 0) {
      return
    }
    const [vendor, ...parentPath] = segments
    const parent = parentPath.length > 0 ? findCategoryByPath(vendor, parentPath) : undefined
    if (parentPath.length > 0 && !parent) {
      window.alert('Target parent folder does not exist.')
      return
    }
    await onRenameCategory(category.id, vendor, category.name, parent?.id || null)
  }

  const handlePromptDeleteCategory = async (category: TemplateCategory) => {
    if (!onDeleteCategory || !window.confirm(`Delete folder "${category.path.join('/')}"?`)) {
      return
    }
    await onDeleteCategory(category.id)
  }

  const openMoveModal = (template: TTemplate) => {
    setMoveTarget(template)
    setMoveVendor(template.vendor)
    setMoveCategoryPath(joinPath(template.categoryPath))
  }

  const handleConfirmMoveTemplate = async () => {
    if (!moveTarget || !onMoveTemplate || !moveVendor.trim()) {
      return
    }
    const categoryPath = moveCategoryPath
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean)
    await onMoveTemplate(moveTarget.id, moveVendor.trim(), categoryPath)
    setMoveTarget(null)
    setMoveVendor('')
    setMoveCategoryPath('')
  }

  const toggleVendorCollapsed = (vendor: string) => {
    setCollapsedVendors((current) => ({
      ...current,
      [vendor]: !current[vendor]
    }))
  }

  const toggleCategoryCollapsed = (categoryId: string) => {
    setCollapsedCategories((current) => ({
      ...current,
      [categoryId]: !current[categoryId]
    }))
  }

  const renderTemplate = (template: TTemplate, depth: number) => {
    const isActive = activeTemplateId === template.id
    const isSelected = selectedTemplateIds.includes(template.id)
    const menuItems: ActionMenuItem[] = []
    if (!multiSelect && onMoveTemplate) {
      menuItems.push({
        key: 'move-template',
        label: 'Move template',
        color: 'var(--accent-primary)',
        onSelect: () => openMoveModal(template)
      })
    }
    if (!multiSelect && onDeleteTemplate) {
      menuItems.push({
        key: 'delete-template',
        label: 'Delete template',
        color: 'var(--error)',
        onSelect: () => onDeleteTemplate(template.id)
      })
    }
    return (
      <div
        key={template.id}
        className="rounded-md transition-colors"
        style={{
          marginLeft: `${depth * 12}px`,
          background: isActive || isSelected
            ? 'linear-gradient(90deg, var(--surface-selected-bg) 0%, var(--surface-selected-bg) 58%, transparent 100%)'
            : 'linear-gradient(90deg, var(--bg-tertiary) 0%, transparent 100%)',
          boxShadow: isActive || isSelected
            ? 'inset 2px 0 0 var(--surface-selected-border)'
            : 'inset 1px 0 0 var(--border-color)'
        }}
      >
        <div
          className="flex items-center gap-2 pl-2 pr-1 py-0.5 cursor-pointer"
          onClick={() => {
            if (multiSelect) {
              onTemplateToggle?.(template.id)
            } else {
              onTemplateClick?.(template.id)
            }
          }}
        >
          <div
            className="flex min-w-0 flex-1 items-center gap-2"
          >
            {multiSelect && (
              <input
                type="checkbox"
                checked={isSelected}
                readOnly
                className="h-3.5 w-3.5 accent-blue-500"
              />
            )}
            <span style={{ color: 'var(--text-muted)' }}>
              <TemplateIcon />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{template.name}</div>
              {renderTemplateMeta ? (
                <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{renderTemplateMeta(template)}</div>
              ) : template.description ? (
                <div className="text-xs truncate mt-1" style={{ color: 'var(--text-muted)' }}>{template.description}</div>
              ) : null}
            </div>
          </div>
          {menuItems.length > 0 && renderActionMenu(`template:${template.id}`, menuItems)}
        </div>
      </div>
    )
  }

  const renderCategory = (category: CategoryNode, vendor: string, depth: number): ReactNode => {
    const directTemplates = templates
      .filter((template) => template.vendor === vendor && joinPath(template.categoryPath) === joinPath(category.path))
      .sort((left, right) => left.name.localeCompare(right.name))
    const hasChildren = directTemplates.length > 0 || category.children.length > 0
    const isCollapsed = collapsedCategories[category.id] ?? false
    const categoryMenuItems: ActionMenuItem[] = []
    if (manageDirectories) {
      if (onCreateCategory) {
        categoryMenuItems.push({
          key: 'add-folder',
          label: 'Add folder',
          color: 'var(--accent-primary)',
          onSelect: () => handlePromptCreateCategory(vendor, category.id)
        })
      }
      if (onRenameCategory) {
        categoryMenuItems.push({
          key: 'rename-folder',
          label: 'Rename folder',
          onSelect: () => handlePromptRenameCategory(category)
        })
        categoryMenuItems.push({
          key: 'move-folder',
          label: 'Move folder',
          onSelect: () => handlePromptMoveCategory(category)
        })
      }
      if (onDeleteCategory) {
        categoryMenuItems.push({
          key: 'delete-folder',
          label: 'Delete folder',
          color: 'var(--error)',
          onSelect: () => handlePromptDeleteCategory(category)
        })
      }
    }

    return (
      <div key={category.id} className="space-y-0.5">
        <div
          className="flex items-center justify-between gap-2 px-1 py-0.5"
          onClick={() => {
            if (hasChildren) {
              toggleCategoryCollapsed(category.id)
            }
          }}
        >
          <div
            className="min-w-0 flex flex-1 items-center gap-2 text-sm truncate"
            style={{
              color: 'var(--text-secondary)',
              paddingLeft: `${depth * 12}px`
            }}
          >
            <span style={{ color: 'var(--text-muted)' }}>
              <ChevronIcon expanded={!isCollapsed} />
            </span>
            <span style={{ color: 'var(--text-muted)' }}>
              <FolderIcon />
            </span>
            <span>{category.name}</span>
          </div>
          {categoryMenuItems.length > 0 && renderActionMenu(`category:${category.id}`, categoryMenuItems)}
        </div>
        {!isCollapsed && (
          <>
            {directTemplates.map((template) => renderTemplate(template, depth + 1))}
            {category.children.map((child) => renderCategory(child, vendor, depth + 1))}
          </>
        )}
      </div>
    )
  }

  const renderActionMenu = (menuKey: string, items: ActionMenuItem[]) => {
    if (items.length === 0) {
      return null
    }

    return (
      <div
        className="relative ml-auto flex w-7 flex-shrink-0 justify-end self-center"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          title="More actions"
          aria-label="More actions"
          className="inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors"
          style={{
            color: openMenuKey === menuKey ? 'var(--accent-primary)' : 'var(--text-secondary)',
            backgroundColor: openMenuKey === menuKey ? 'var(--surface-selected-bg)' : 'var(--bg-tertiary)',
            borderColor: openMenuKey === menuKey ? 'var(--surface-selected-border)' : 'var(--border-color)'
          }}
          onClick={() => {
            setOpenMenuKey((current) => current === menuKey ? null : menuKey)
          }}
        >
          <ActionMenuIcon active={openMenuKey === menuKey} />
        </button>
        {openMenuKey === menuKey && (
          <div
            className="absolute right-0 top-full mt-1 min-w-[9rem] rounded-md border py-1 shadow-lg z-20"
            style={{
              backgroundColor: 'var(--bg-secondary)',
              borderColor: 'var(--border-color)'
            }}
          >
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                className="w-full text-left px-3 py-1.5 text-xs transition-colors"
                style={{
                  color: item.color || 'var(--text-primary)',
                  backgroundColor: 'transparent'
                }}
                onClick={() => {
                  setOpenMenuKey(null)
                  void item.onSelect()
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="p-2">
      {(title || (manageDirectories && onCreateVendor)) && (
        <div className="flex items-center justify-between gap-2 mb-2 px-1">
          {title ? (
            <h3 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{title}</h3>
          ) : (
            <div />
          )}
          {manageDirectories && onCreateVendor && (
            <IconButton title="Add vendor" color="var(--accent-primary)" onClick={() => { void handlePromptCreateVendor() }}>
              <AddIcon />
            </IconButton>
          )}
        </div>
      )}
      {loading ? (
        <p className="text-xs px-2 py-4 text-center" style={{ color: 'var(--text-muted)' }}>Loading...</p>
      ) : vendorNames.length === 0 && templates.length === 0 ? (
        <p className="text-xs px-2 py-4 text-center" style={{ color: 'var(--text-muted)' }}>{emptyText}</p>
      ) : (
        <div className="space-y-1">
          {vendorNames.map((vendor) => {
            const rootTemplates = (templatesByVendor.get(vendor) || [])
              .filter((template) => template.categoryPath.length === 0)
              .sort((left, right) => left.name.localeCompare(right.name))
            const categoryTree = buildCategoryTree(vendor)
            const hasContent = rootTemplates.length > 0 || categoryTree.length > 0
            const isCollapsed = collapsedVendors[vendor] ?? false
            const vendorMenuItems: ActionMenuItem[] = []
            if (manageDirectories) {
              if (onCreateCategory) {
                vendorMenuItems.push({
                  key: 'add-folder',
                  label: 'Add folder',
                  color: 'var(--accent-primary)',
                  onSelect: () => handlePromptCreateCategory(vendor, null)
                })
              }
              if (onRenameVendor) {
                vendorMenuItems.push({
                  key: 'rename-vendor',
                  label: 'Rename vendor',
                  onSelect: () => handlePromptRenameVendor(vendor)
                })
              }
              if (onDeleteVendor) {
                vendorMenuItems.push({
                  key: 'delete-vendor',
                  label: 'Delete vendor',
                  color: 'var(--error)',
                  onSelect: () => handlePromptDeleteVendor(vendor)
                })
              }
            }
            if (!hasContent && !manageDirectories) {
              return null
            }
            return (
              <div key={vendor} className="space-y-0.5">
                <div
                  className="flex items-center justify-between gap-2 px-1 py-0.5"
                  onClick={() => {
                    if (hasContent) {
                      toggleVendorCollapsed(vendor)
                    }
                  }}
                >
                  <div className="text-sm font-medium truncate flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>
                      <ChevronIcon expanded={!isCollapsed} />
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}>
                      <VendorIcon />
                    </span>
                    <span>{vendor}</span>
                  </div>
                  {vendorMenuItems.length > 0 && renderActionMenu(`vendor:${vendor}`, vendorMenuItems)}
                </div>
                {!isCollapsed && rootTemplates.map((template) => renderTemplate(template, 1))}
                {!isCollapsed && categoryTree.map((category) => renderCategory(category, vendor, 1))}
                {!hasContent && (
                  <div className="text-xs ml-3" style={{ color: 'var(--text-muted)' }}>Empty</div>
                )}
              </div>
            )
          })}
        </div>
      )}
      {moveTarget && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'var(--overlay-backdrop)' }} onClick={(e) => { if (e.target === e.currentTarget) setMoveTarget(null) }}>
          <div className="rounded-lg p-6 w-[420px] shadow-xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Move Template</h3>
            <div className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
              {moveTarget.name}
            </div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Vendor</label>
            <select
              value={moveVendor}
              onChange={(event) => {
                setMoveVendor(event.target.value)
                setMoveCategoryPath('')
              }}
              className="w-full px-3 py-2 border rounded-md mb-3"
              style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
            >
              {vendorNames.map((vendor) => (
                <option key={vendor} value={vendor}>{vendor}</option>
              ))}
            </select>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Folder</label>
            <select
              value={moveCategoryPath}
              onChange={(event) => setMoveCategoryPath(event.target.value)}
              className="w-full px-3 py-2 border rounded-md mb-4"
              style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
            >
              <option value="">Vendor Root</option>
              {moveCategoryOptions.map((path) => (
                <option key={path} value={path}>{path}</option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <button
                className="btn"
                onClick={() => {
                  setMoveTarget(null)
                  setMoveVendor('')
                  setMoveCategoryPath('')
                }}
              >
                Cancel
              </button>
              <button
                className="btn"
                onClick={() => { void handleConfirmMoveTemplate() }}
                disabled={!moveVendor.trim()}
              >
                Move
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
