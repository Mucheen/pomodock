import { useEffect, useMemo, useRef, useState } from 'react'

const PHASES = {
  focus: { label: '专注时间', shortLabel: '专注', icon: '●' },
  shortBreak: { label: '短暂休息', shortLabel: '休息', icon: '◆' },
  longBreak: { label: '长休息', shortLabel: '长休', icon: '◆' },
}

const FALLBACK_STATE = {
  config: {
    focusMinutes: 25,
    shortBreakMinutes: 5,
    longBreakMinutes: 15,
    roundsBeforeLongBreak: 4,
  },
  phase: 'focus',
  status: 'idle',
  remainingMs: 25 * 60_000,
  completedFocusRounds: 0,
  alarm: false,
  collapsed: false,
}

function formatTime(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function phaseDuration(state) {
  const key = {
    focus: 'focusMinutes',
    shortBreak: 'shortBreakMinutes',
    longBreak: 'longBreakMinutes',
  }[state.phase]
  return state.config[key] * 60_000
}

function useAlarmSound(alarm) {
  const contextRef = useRef(null)
  const intervalRef = useRef(null)
  const previousAlarm = useRef(false)

  const primeAudio = () => {
    if (!contextRef.current) {
      contextRef.current = new AudioContext()
    }
    if (contextRef.current.state === 'suspended') contextRef.current.resume()
  }

  useEffect(() => {
    const playChime = () => {
      const context = contextRef.current
      if (!context || context.state !== 'running') return
      const now = context.currentTime
      ;[0, 0.18, 0.4].forEach((delay, index) => {
        const oscillator = context.createOscillator()
        const gain = context.createGain()
        oscillator.type = 'sine'
        oscillator.frequency.value = [659, 784, 988][index]
        gain.gain.setValueAtTime(0.0001, now + delay)
        gain.gain.exponentialRampToValueAtTime(0.22, now + delay + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.32)
        oscillator.connect(gain).connect(context.destination)
        oscillator.start(now + delay)
        oscillator.stop(now + delay + 0.34)
      })
    }

    if (alarm && !previousAlarm.current) {
      playChime()
      intervalRef.current = window.setInterval(playChime, 6000)
    }
    if (!alarm && intervalRef.current) {
      window.clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    previousAlarm.current = alarm

    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current)
    }
  }, [alarm])

  return primeAudio
}

function ProgressRing({ progress, children, compact = false }) {
  const radius = compact ? 20 : 112
  const size = compact ? 48 : 250
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - Math.min(1, Math.max(0, progress)))

  return (
    <div className={`ring ${compact ? 'ring--compact' : ''}`} style={{ '--ring-size': `${size}px` }}>
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="ring__track" cx={size / 2} cy={size / 2} r={radius} />
        <circle
          className="ring__progress"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <div className="ring__content">{children}</div>
    </div>
  )
}

function CollapsedTimer({ state, onExpand }) {
  const progress = state.remainingMs / phaseDuration(state)
  const phase = PHASES[state.phase]
  return (
    <button className={`edge-tab edge-tab--${state.phase}`} onClick={onExpand} aria-label="展开番茄钟">
      <span className="edge-tab__grip" />
      <ProgressRing progress={progress} compact>
        <span className="edge-tab__time">{Math.max(0, Math.ceil(state.remainingMs / 60_000))}</span>
      </ProgressRing>
      <span className="edge-tab__label">{phase.shortLabel}</span>
      <span className={`edge-tab__status ${state.status === 'running' ? 'is-running' : ''}`} />
    </button>
  )
}

function Settings({ config, onSave, onClose }) {
  const [draft, setDraft] = useState(config)
  const field = (key, label, suffix = '分钟') => (
    <label className="setting-row">
      <span>{label}</span>
      <span className="number-field">
        <input
          type="number"
          min={key === 'roundsBeforeLongBreak' ? 2 : 1}
          max={key === 'roundsBeforeLongBreak' ? 12 : 180}
          value={draft[key]}
          onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
        />
        <small>{suffix}</small>
      </span>
    </label>
  )

  return (
    <div className="modal-backdrop">
      <section className="settings-card" aria-label="计时设置">
        <div className="modal-heading">
          <div>
            <span className="eyebrow">TIMER SETTINGS</span>
            <h2>调整节奏</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭设置">×</button>
        </div>
        <div className="setting-list">
          {field('focusMinutes', '专注时长')}
          {field('shortBreakMinutes', '短休息')}
          {field('longBreakMinutes', '长休息')}
          {field('roundsBeforeLongBreak', '长休间隔', '轮')}
        </div>
        <button className="primary-button primary-button--wide" onClick={() => onSave(draft)}>保存设置</button>
        <p className="settings-note">保存会重置当前阶段的倒计时。</p>
      </section>
    </div>
  )
}

function Alarm({ state, onFinish }) {
  const completedFocus = state.phase === 'focus'
  return (
    <div className="modal-backdrop modal-backdrop--alarm">
      <section className="alarm-card">
        <div className="alarm-card__halo"><span>✓</span></div>
        <span className="eyebrow">TIME IS UP</span>
        <h2>{completedFocus ? '本轮专注完成' : '休息结束'}</h2>
        <p>{completedFocus ? '做得很好。喝口水，活动一下肩颈。' : '状态不错，准备开始下一轮吧。'}</p>
        <button className="primary-button primary-button--wide" onClick={() => onFinish(true)}>
          {completedFocus ? '开始休息' : '开始专注'}
        </button>
        <button className="text-button" onClick={() => onFinish(false)}>稍后再开始</button>
      </section>
    </div>
  )
}

function App() {
  const [state, setState] = useState(FALLBACK_STATE)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [ready, setReady] = useState(false)
  const primeAudio = useAlarmSound(state.alarm)
  const api = window.pomodoro

  useEffect(() => {
    if (!api) {
      setReady(true)
      return undefined
    }
    api.getState().then((next) => {
      setState(next)
      setReady(true)
    })
    return api.onState(setState)
  }, [api])

  useEffect(() => {
    document.body.dataset.collapsed = String(state.collapsed)
    document.body.dataset.phase = state.phase
  }, [state.collapsed, state.phase])

  const progress = useMemo(() => state.remainingMs / phaseDuration(state), [state])
  const phase = PHASES[state.phase]
  const statusText = {
    running: '正在计时',
    paused: '已暂停',
    idle: '准备开始',
  }[state.status]

  const runAction = async (action) => {
    primeAudio()
    if (!api) return
    const next = await action()
    setState(next)
  }

  const setWindowCollapsed = (nextCollapsed) => {
    primeAudio()
    if (!api) {
      setState((current) => ({ ...current, collapsed: nextCollapsed }))
      return
    }

    if (nextCollapsed) {
      setState((current) => ({ ...current, collapsed: true }))
      window.requestAnimationFrame(() => {
        api.setCollapsed(true).then(setState)
      })
      return
    }

    api.setCollapsed(false).then(setState)
  }

  if (!ready) return null
  if (state.collapsed) {
    return <CollapsedTimer state={state} onExpand={() => setWindowCollapsed(false)} />
  }

  return (
    <main className={`app-shell app-shell--${state.phase}`}>
      <header className="titlebar">
        <div className="brand">
          <span className="brand__mark"><i /></span>
          <span>POMODOCK</span>
        </div>
        <div className="titlebar__actions">
          <button className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="打开设置">⌘</button>
          <button className="icon-button" onClick={() => setWindowCollapsed(true)} aria-label="收起到屏幕边缘">→</button>
          <button className="icon-button icon-button--quit" onClick={() => api?.quit()} aria-label="退出">×</button>
        </div>
      </header>

      <section className="timer-section">
        <div className="phase-pill"><span />{phase.label}</div>
        <ProgressRing progress={progress}>
          <span className="timer-digits">{formatTime(state.remainingMs)}</span>
          <span className="timer-status"><i className={state.status === 'running' ? 'is-running' : ''} />{statusText}</span>
        </ProgressRing>
      </section>

      <section className="session-progress">
        <div className="session-progress__copy">
          <span>今日节奏</span>
          <strong>{state.completedFocusRounds} 次专注</strong>
        </div>
        <div className="rounds" aria-label="长休息进度">
          {Array.from({ length: state.config.roundsBeforeLongBreak }, (_, index) => (
            <span
              key={index}
              className={index < state.completedFocusRounds % state.config.roundsBeforeLongBreak ? 'is-complete' : ''}
            />
          ))}
        </div>
      </section>

      <section className="controls">
        <button className="secondary-button" onClick={() => runAction(() => api.reset())} aria-label="重置计时">↺</button>
        <button
          className="primary-button"
          onClick={() => runAction(() => state.status === 'running' ? api.pause() : api.start())}
        >
          <span>{state.status === 'running' ? 'Ⅱ' : '▶'}</span>
          {state.status === 'running'
            ? '暂停'
            : state.status === 'paused'
              ? '继续'
              : state.phase === 'focus' ? '开始专注' : '开始休息'}
        </button>
        <button className="secondary-button" onClick={() => runAction(() => api.skip())} aria-label="跳过当前阶段">↠</button>
      </section>

      <footer className="hint"><span>→</span> 收起后，计时会继续在桌面后台运行</footer>

      {settingsOpen && (
        <Settings
          config={state.config}
          onClose={() => setSettingsOpen(false)}
          onSave={(config) => runAction(() => api.configure(config)).then(() => setSettingsOpen(false))}
        />
      )}
      {state.alarm && <Alarm state={state} onFinish={(startNext) => runAction(() => api.finishAlarm(startNext))} />}
    </main>
  )
}

export default App
