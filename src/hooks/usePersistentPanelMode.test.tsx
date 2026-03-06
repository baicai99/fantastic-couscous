import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { usePersistentPanelMode } from './usePersistentPanelMode'

describe('usePersistentPanelMode', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads persisted collapsed mode from localStorage', () => {
    localStorage.setItem('panel:test', '1')
    const { result } = renderHook(() => usePersistentPanelMode({ storageKey: 'panel:test' }))
    expect(result.current.mode).toBe('collapsed')
  })

  it('toggles mode and persists to localStorage', () => {
    const { result } = renderHook(() => usePersistentPanelMode({ storageKey: 'panel:test' }))

    expect(result.current.mode).toBe('expanded')
    act(() => {
      result.current.toggleMode()
    })
    expect(result.current.mode).toBe('collapsed')
    expect(localStorage.getItem('panel:test')).toBe('1')
  })

  it('falls back to default mode when localStorage throws', () => {
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    const { result } = renderHook(() =>
      usePersistentPanelMode({
        storageKey: 'panel:test',
        defaultMode: 'collapsed',
      }),
    )

    expect(result.current.mode).toBe('collapsed')
    act(() => {
      result.current.toggleMode()
    })
    expect(result.current.mode).toBe('expanded')
    expect(getItemSpy).toHaveBeenCalled()
    expect(setItemSpy).toHaveBeenCalled()
  })
})
