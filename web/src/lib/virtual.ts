import { useCallback, useEffect, useMemo, useState } from 'react'

interface Metrics {
  scrollTop: number
  viewportHeight: number
  viewportWidth: number
}

export interface VirtualRange {
  start: number
  end: number
  offsetY: number
  totalHeight: number
}

export function virtualRange(
  total: number,
  rowHeight: number,
  viewportHeight: number,
  scrollTop: number,
  overscan = 6,
): VirtualRange {
  if (total <= 0 || rowHeight <= 0) {
    return { start: 0, end: 0, offsetY: 0, totalHeight: 0 }
  }
  const visible = Math.ceil(viewportHeight / rowHeight)
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const end = Math.min(total, start + visible + overscan * 2)
  return { start, end, offsetY: start * rowHeight, totalHeight: total * rowHeight }
}

export interface VirtualGridRange extends VirtualRange {
  columns: number
}

export function virtualGridRange(
  total: number,
  viewportWidth: number,
  minColumnWidth: number,
  rowHeight: number,
  gap: number,
  viewportHeight: number,
  scrollTop: number,
  overscanRows = 3,
): VirtualGridRange {
  if (total <= 0) {
    return { start: 0, end: 0, offsetY: 0, totalHeight: 0, columns: 1 }
  }
  const stride = rowHeight + gap
  const columns = Math.max(1, Math.floor((viewportWidth + gap) / (minColumnWidth + gap)))
  const rows = Math.ceil(total / columns)
  const startRow = Math.max(0, Math.floor(scrollTop / stride) - overscanRows)
  const visibleRows = Math.ceil(viewportHeight / stride)
  const endRow = Math.min(rows, startRow + visibleRows + overscanRows * 2)
  return {
    start: startRow * columns,
    end: Math.min(total, endRow * columns),
    offsetY: startRow * stride,
    totalHeight: Math.max(0, rows * stride - gap),
    columns,
  }
}

export function useVirtualScroll() {
  const [node, setNode] = useState<HTMLDivElement | null>(null)
  const [metrics, setMetrics] = useState<Metrics>({ scrollTop: 0, viewportHeight: 0, viewportWidth: 0 })

  const readMetrics = useCallback((el: HTMLDivElement) => {
    setMetrics({
      scrollTop: el.scrollTop,
      viewportHeight: el.clientHeight,
      viewportWidth: el.clientWidth,
    })
  }, [])

  const containerRef = useCallback((el: HTMLDivElement | null) => {
    setNode(el)
    if (el) readMetrics(el)
  }, [readMetrics])

  const updateMetrics = useCallback(() => {
    if (node) readMetrics(node)
  }, [node, readMetrics])

  useEffect(() => {
    updateMetrics()
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateMetrics)
    observer.observe(node)
    return () => observer.disconnect()
  }, [node, updateMetrics])

  const onScroll = useCallback(() => updateMetrics(), [updateMetrics])
  return useMemo(
    () => ({ containerRef, metrics, onScroll, updateMetrics }),
    [containerRef, metrics, onScroll, updateMetrics],
  )
}
