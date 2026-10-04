import test from 'node:test'
import assert from 'node:assert/strict'
import { createAlarmSound } from '../src/alarm.mjs'

function harness(suspended = false) {
  const contexts = []
  const intervals = new Map()
  let finishResume
  class FakeAudioContext {
    constructor() { this.state = suspended ? 'suspended' : 'running'; this.currentTime = 0; this.destination = {}; this.chimes = 0; contexts.push(this) }
    resume() { return new Promise((resolve) => { finishResume = () => { this.state = 'running'; resolve() } }) }
    close() { this.state = 'closed'; return Promise.resolve() }
    createOscillator() {
      return { frequency: {}, connect: () => ({ connect() {} }), start: () => { this.chimes += 1 }, stop() {}, disconnect() {} }
    }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, disconnect() {} } }
  }
  const sound = createAlarmSound({
    AudioContext: FakeAudioContext,
    setInterval: (callback) => { intervals.set(1, callback); return 1 },
    clearInterval: (id) => intervals.delete(id),
  })
  return { sound, contexts, intervals, resume: () => finishResume() }
}

test('audio is allocated only for an alarm and closed after every dismissal', async () => {
  const app = harness()
  assert.equal(app.contexts.length, 0)
  for (let alarm = 0; alarm < 10; alarm += 1) {
    await app.sound.start()
    await app.sound.start()
    assert.equal(app.contexts.length, alarm + 1)
    assert.equal(app.contexts.at(-1).chimes, 3)
    assert.equal(app.intervals.size, 1)
    app.sound.stop()
    app.sound.stop()
    assert.equal(app.contexts.at(-1).state, 'closed')
    assert.equal(app.intervals.size, 0)
  }
})

test('dismissing an alarm during audio resume cannot restart its interval', async () => {
  const app = harness(true)
  const starting = app.sound.start()
  app.sound.stop()
  app.resume()
  await starting
  assert.equal(app.intervals.size, 0)
  assert.equal(app.contexts[0].chimes, 0)
})
