// Injected only when Rust is compiled with the smoke-test feature.
;(async () => {
  const invoke = (command, args) => window.__TAURI_INTERNALS__.invoke(command, args)
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const check = (condition, message) => { if (!condition) throw new Error(message) }
  const steps = []
  try {
    for (let i=0; i<50 && !window.pomodoro; i++) await wait(100)
    check(!!window.pomodoro, 'native bridge initialized')
    const api=window.pomodoro
    await invoke('smoke_step', { step:'seed', payload:null })
    await wait(200)
    let state=await api.getState()
    check(state.todayFocusRounds === 0, 'today starts at zero')
    const history=await api.getHistory()
    check(history.dailyRecords['2026-10-20'].focusRounds === 2, 'history available')
    steps.push('native timer and history')
    await api.setCollapsed(true); await wait(200)
    const compact=await invoke('smoke_step',{step:'bounds',payload:null})
    check(Math.round(compact.size.width/compact.scale)===36 && Math.round(compact.size.height/compact.scale)===76,'compact dimensions')
    check(!!document.querySelector('.edge-tab'), 'compact UI rendered')
    await api.setCollapsed(false)
    await invoke('smoke_step',{step:'resize',payload:null}); await wait(200)
    const size=await invoke('smoke_step',{step:'bounds',payload:null})
    check(Math.round(size.size.width/size.scale)===320 && Math.round(size.size.height/size.scale)===500,'minimum size')
    await api.setCollapsed(true); await api.setCollapsed(false); await wait(200)
    const restored=await invoke('smoke_step',{step:'bounds',payload:null})
    check(restored.size.width===size.size.width && restored.size.height===size.size.height,'size restored')
    check(document.querySelector('.controls').getBoundingClientRect().bottom <= innerHeight,'controls fit small window')
    steps.push('compact tab and persisted window size')
    await api.start(); await api.setCollapsed(true); await wait(2600)
    state=await api.getState()
    check(state.alarm && !state.collapsed && state.todayFocusRounds===1,'native deadline expands and records focus')
    check(!!document.querySelector('.alarm-card'),'alarm rendered')
    await api.finishAlarm(false); await wait(200)
    document.querySelector('.session-progress').click(); await wait(300)
    check(!!document.querySelector('.history-day.has-record'),'calendar rendered')
    steps.push('completion alarm and calendar')
    await invoke('smoke_step',{step:'finish',payload:{passed:true,steps,userAgent:navigator.userAgent}})
  } catch (error) {
    await invoke('smoke_step',{step:'finish',payload:{passed:false,steps,error:String(error)}})
  }
})()
