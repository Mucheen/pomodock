const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pomodoro', {
  getState: () => ipcRenderer.invoke('timer:get-state'),
  getHistory: () => ipcRenderer.invoke('timer:get-history'),
  configure: (config) => ipcRenderer.invoke('timer:configure', config),
  start: () => ipcRenderer.invoke('timer:start'),
  pause: () => ipcRenderer.invoke('timer:pause'),
  reset: () => ipcRenderer.invoke('timer:reset'),
  skip: () => ipcRenderer.invoke('timer:skip'),
  finishAlarm: (startNext) => ipcRenderer.invoke('timer:finish-alarm', startNext),
  setCollapsed: (collapsed) => ipcRenderer.invoke('window:set-collapsed', collapsed),
  quit: () => ipcRenderer.invoke('window:quit'),
  onState: (callback) => {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('timer:state', listener)
    return () => ipcRenderer.removeListener('timer:state', listener)
  },
})
