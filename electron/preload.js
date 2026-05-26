const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getSavePath: () => ipcRenderer.invoke('get-save-path'),
  setSavePath: (savePath) => ipcRenderer.invoke('set-save-path', savePath)
});
