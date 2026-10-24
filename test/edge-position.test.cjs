const test = require('node:test')
const assert = require('node:assert/strict')
const { edgeBounds, edgePositionAt, edgePositionFromWindow, normalizeEdgePosition, normalizeExpandedSize, resizeBounds } = require('../electron/edge-position.cjs')

test('edge placement honors work area offsets and clamps the expanded panel', () => {
  const display = { id: 7, workArea: { x: -1600, y: 40, width: 1600, height: 900 } }
  assert.deepEqual(edgeBounds(display, { displayId: 7, ratio: 0 }, true), { x: -36, y: 40, width: 36, height: 76 })
  assert.equal(edgeBounds(display, { displayId: 7, ratio: 1 }, true).y, 864)
  assert.equal(edgeBounds(display, { displayId: 7, ratio: 0 }, false).y, 40)
  assert.equal(edgeBounds(display, { displayId: 7, ratio: 1 }, false).y, 320)
  assert.deepEqual(edgePositionAt(display, -1000), { displayId: 7, ratio: 0 })
  assert.deepEqual(edgePositionAt(display, 2000), { displayId: 7, ratio: 1 })
})

test('invalid persisted positions fall back to the center and small screens never yield NaN', () => {
  for (const position of [null, {}, { displayId: '7', ratio: 0.5 }, { displayId: 7, ratio: NaN }]) {
    assert.equal(normalizeEdgePosition(position), null)
  }
  const display = { id: 1, workArea: { x: 0, y: 10, width: 800, height: 60 } }
  assert.deepEqual(edgePositionAt(display, 100), { displayId: 1, ratio: 0 })
  assert.equal(edgeBounds(display, null, true).y, 10)
})

test('resizing clamps every edge and keeps the opposite corner fixed', () => {
  const area = { x: 0, y: 40, width: 1400, height: 900 }
  const start = { x: 900, y: 140, width: 400, height: 620 }
  assert.deepEqual(resizeBounds(start, 'nw', { x: 1000, y: 1000 }, area), { x: 980, y: 260, width: 320, height: 500 })
  assert.deepEqual(resizeBounds(start, 'se', { x: 5000, y: 5000 }, area), { x: 900, y: 140, width: 500, height: 800 })
  assert.deepEqual(normalizeExpandedSize({ width: -10, height: 5 }), { width: 320, height: 500 })
  assert.deepEqual(normalizeExpandedSize({ width: NaN, height: 800 }), { width: 392, height: 620 })
  assert.equal(edgeBounds({ id: 1, workArea: area }, null, false, { width: 2000, height: 2000 }).width, 1400)
})

test('moving horizontally preserves a top-clamped vertical anchor', () => {
  const display = { id: 1, workArea: { x: 0, y: 40, width: 1400, height: 900 } }
  const previous = { displayId: 1, ratio: 0 }
  const bounds = { ...edgeBounds(display, previous, false), x: 100 }
  assert.deepEqual(edgePositionFromWindow(display, bounds, previous), previous)
})

test('remembering a moved window uses its center and does not project an unplugged screen onto another', () => {
  const display = { id: 2, workArea: { x: -1600, y: -100, width: 1600, height: 1000 } }
  const previous = { displayId: 1, ratio: 0.5 }
  const bounds = { x: -1200, y: 100, width: 392, height: 620 }
  const captured = edgePositionFromWindow(display, bounds, previous)
  assert.equal(captured.displayId, 2)
  assert.equal(edgeBounds(display, captured, true).y, 372)
  assert.deepEqual(edgePositionFromWindow(display, { ...bounds, x: 1200 }, previous), { displayId: 2, ratio: 0.5 })
})
