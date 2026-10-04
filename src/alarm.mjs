// The audio device and context only live while the completion alarm is active.
export function createAlarmSound({ AudioContext, setInterval, clearInterval }) {
  let context = null
  let interval = null

  const play = () => {
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
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect() }
      oscillator.start(now + delay)
      oscillator.stop(now + delay + 0.34)
    })
  }

  return {
    async start() {
      if (context) return
      const audio = new AudioContext()
      context = audio
      if (audio.state === 'suspended') await audio.resume()
      // The alarm may have been dismissed while resume() was pending.
      if (context !== audio) return
      play()
      interval = setInterval(play, 6000)
    },
    stop() {
      if (interval !== null) clearInterval(interval)
      interval = null
      const audio = context
      context = null
      if (audio && audio.state !== 'closed') void audio.close().catch(() => {})
    },
  }
}
