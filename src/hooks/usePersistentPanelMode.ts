import { useCallback, useEffect, useState } from 'react'

export type PanelMode = 'expanded' | 'collapsed'

interface UsePersistentPanelModeOptions {
  storageKey: string
  defaultMode?: PanelMode
}

const STORAGE_VALUE_BY_MODE: Record<PanelMode, string> = {
  expanded: '0',
  collapsed: '1',
}

export function usePersistentPanelMode(options: UsePersistentPanelModeOptions) {
  const { storageKey, defaultMode = 'expanded' } = options

  const [mode, setMode] = useState<PanelMode>(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      if (stored === STORAGE_VALUE_BY_MODE.collapsed) {
        return 'collapsed'
      }
      if (stored === STORAGE_VALUE_BY_MODE.expanded) {
        return 'expanded'
      }
      return defaultMode
    } catch {
      return defaultMode
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, STORAGE_VALUE_BY_MODE[mode])
    } catch {
      // Ignore storage errors in restricted environments.
    }
  }, [mode, storageKey])

  const toggleMode = useCallback(() => {
    setMode((prev) => (prev === 'expanded' ? 'collapsed' : 'expanded'))
  }, [])

  return { mode, setMode, toggleMode }
}
