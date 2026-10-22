// Keep the UI shared with the stable Electron build while Lite uses native Rust.
export async function initializeDesktop() {
  if (window.pomodoro || !window.__TAURI_INTERNALS__) return
  const [{ invoke }, { listen }, { getCurrentWindow }] = await Promise.all([
    import('@tauri-apps/api/core'), import('@tauri-apps/api/event'), import('@tauri-apps/api/window'),
  ])
  const callbacks = new Set()
  const unlisten = await listen('timer:state', ({ payload }) => callbacks.forEach((callback) => callback(payload)))
  const action = (name, payload = null) => invoke('timer_action', { action: name, payload })
  // Serialize gestures: native window movement and pointer release must stay ordered.
  let pending = Promise.resolve()
  const gesture = (command, args) => {
    pending = pending.then(() => invoke(command, args)).catch(console.error)
  }
  window.pomodoro = {
    getState: () => invoke('get_state'), getHistory: () => invoke('get_history'),
    configure: (config) => action('configure', config),
    start: () => action('start'), pause: () => action('pause'), reset: () => action('reset'), skip: () => action('skip'),
    finishAlarm: (startNext) => action('finish-alarm', startNext),
    setCollapsed: (collapsed) => action('collapse', collapsed),
    beginEdgeDrag: () => gesture('gesture_start', { kind: 'drag' }),
    moveEdgeDrag: () => gesture('gesture_move'), endEdgeDrag: () => gesture('gesture_end'),
    beginResize: (kind) => gesture('gesture_start', { kind }),
    moveResize: () => gesture('gesture_move'), endResize: () => gesture('gesture_end'),
    quit: () => invoke('quit'),
    onState: (callback) => { callbacks.add(callback); return () => callbacks.delete(callback) },
  }
  document.addEventListener('pointerdown', (event) => {
    if (event.button === 0 && event.target.closest('.titlebar') && !event.target.closest('button')) {
      void getCurrentWindow().startDragging().catch(console.error)
    }
  })
  window.addEventListener('beforeunload', unlisten, { once: true })
}
