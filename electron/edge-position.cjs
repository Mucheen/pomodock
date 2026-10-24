const COLLAPSED_SIZE = { width: 36, height: 76 }
const EXPANDED_SIZE = { width: 392, height: 620 }
const MIN_EXPANDED_SIZE = { width: 320, height: 500 }
const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

function normalizeEdgePosition(value) {
  if (!value || !Number.isFinite(value.displayId) || !Number.isFinite(value.ratio)) return null
  return { displayId: value.displayId, ratio: clamp(value.ratio, 0, 1) }
}

function normalizeExpandedSize(value) {
  if (!value || !Number.isFinite(value.width) || !Number.isFinite(value.height)) return { ...EXPANDED_SIZE }
  return { width: Math.round(clamp(value.width, MIN_EXPANDED_SIZE.width, 2000)), height: Math.round(clamp(value.height, MIN_EXPANDED_SIZE.height, 2000)) }
}

function edgeBounds(display, position, collapsed, expandedSize) {
  const area = display.workArea
  const preferred = normalizeExpandedSize(expandedSize)
  const size = collapsed ? COLLAPSED_SIZE : { width: Math.min(area.width, preferred.width), height: Math.min(area.height, preferred.height) }
  const ratio = normalizeEdgePosition(position)?.ratio ?? 0.5
  const tabY = area.y + Math.max(0, area.height - COLLAPSED_SIZE.height) * ratio
  const center = tabY + COLLAPSED_SIZE.height / 2
  const y = clamp(center - size.height / 2, area.y, area.y + Math.max(0, area.height - size.height))
  return { x: area.x + area.width - size.width, y: Math.round(y), ...size }
}

function edgePositionAt(display, y) {
  const travel = Math.max(0, display.workArea.height - COLLAPSED_SIZE.height)
  return { displayId: display.id, ratio: travel ? clamp((y - display.workArea.y) / travel, 0, 1) : 0 }
}

function edgePositionFromWindow(display, bounds, previous, expandedSize) {
  const expected = edgeBounds(display, previous, false, expandedSize)
  const area = display.workArea
  const intersects = bounds.x < area.x + area.width && bounds.x + bounds.width > area.x
    && bounds.y < area.y + area.height && bounds.y + bounds.height > area.y
  // Expanding near an edge clamps the large panel. Do not turn that clamp into
  // a new tab position on every collapse, or top/bottom anchors slowly drift.
  if (!intersects || (Math.abs(bounds.y - expected.y) <= 1 && Math.abs(bounds.height - expected.height) <= 1)) {
    return { displayId: display.id, ratio: normalizeEdgePosition(previous)?.ratio ?? 0.5 }
  }
  return edgePositionAt(display, bounds.y + bounds.height / 2 - COLLAPSED_SIZE.height / 2)
}

function resizeBounds(bounds, direction, delta, area) {
  const minWidth = Math.min(MIN_EXPANDED_SIZE.width, area.width)
  const minHeight = Math.min(MIN_EXPANDED_SIZE.height, area.height)
  let left = bounds.x, top = bounds.y, right = left + bounds.width, bottom = top + bounds.height
  if (direction.includes('w')) left = clamp(left + delta.x, area.x, right - minWidth)
  if (direction.includes('e')) right = clamp(right + delta.x, left + minWidth, area.x + area.width)
  if (direction.includes('n')) top = clamp(top + delta.y, area.y, bottom - minHeight)
  if (direction.includes('s')) bottom = clamp(bottom + delta.y, top + minHeight, area.y + area.height)
  return { x: Math.round(left), y: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) }
}

module.exports = { COLLAPSED_SIZE, EXPANDED_SIZE, normalizeEdgePosition, normalizeExpandedSize, edgeBounds, edgePositionAt, edgePositionFromWindow, resizeBounds }
