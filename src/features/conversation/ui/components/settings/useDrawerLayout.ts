import { useCallback, useEffect, useRef, useState } from 'react'

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function useDrawerLayout(input: {
  isDrawerOpen: boolean
  channelsVersion: string
  minWidth: number
  maxRatio: number
  horizontalAllowance: number
}) {
  const { isDrawerOpen, channelsVersion, minWidth, maxRatio, horizontalAllowance } = input
  const [drawerWidth, setDrawerWidth] = useState<number>(minWidth)
  const tableContainerRef = useRef<HTMLDivElement | null>(null)

  const getDrawerMaxWidth = useCallback(() => {
    if (typeof window === 'undefined') {
      return minWidth
    }
    return Math.max(minWidth, Math.floor(window.innerWidth * maxRatio))
  }, [maxRatio, minWidth])

  const recalculateDrawerWidth = useCallback(() => {
    if (!isDrawerOpen) {
      return
    }
    const wrapper = tableContainerRef.current
    const tableElement = wrapper?.querySelector('.ant-table-content table') as HTMLElement | null
    const tableIntrinsicWidth = tableElement ? Math.ceil(tableElement.scrollWidth) : 0
    const expectedContentWidth =
      tableIntrinsicWidth > 0
        ? tableIntrinsicWidth + horizontalAllowance
        : minWidth
    const nextWidth = clampNumber(expectedContentWidth, minWidth, getDrawerMaxWidth())
    setDrawerWidth((prev) => (Math.abs(prev - nextWidth) < 1 ? prev : nextWidth))
  }, [getDrawerMaxWidth, horizontalAllowance, isDrawerOpen, minWidth])

  useEffect(() => {
    if (!isDrawerOpen) {
      return
    }
    const frame = window.requestAnimationFrame(() => {
      recalculateDrawerWidth()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [channelsVersion, isDrawerOpen, recalculateDrawerWidth])

  useEffect(() => {
    if (!isDrawerOpen) {
      return
    }
    const onResize = () => {
      recalculateDrawerWidth()
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [isDrawerOpen, recalculateDrawerWidth])

  useEffect(() => {
    if (!isDrawerOpen) {
      return
    }
    const wrapper = tableContainerRef.current
    if (!wrapper || typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(() => {
      recalculateDrawerWidth()
    })
    observer.observe(wrapper)
    const tableElement = wrapper.querySelector('.ant-table-content table')
    if (tableElement instanceof HTMLElement) {
      observer.observe(tableElement)
    }
    return () => observer.disconnect()
  }, [channelsVersion, isDrawerOpen, recalculateDrawerWidth])

  return {
    tableContainerRef,
    drawerWidth,
    recalculateDrawerWidth,
  }
}
