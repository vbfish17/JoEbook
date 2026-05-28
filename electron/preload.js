const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getSavePath: () => ipcRenderer.invoke('get-save-path'),
  setSavePath: (savePath) => ipcRenderer.invoke('set-save-path', savePath),
  setSourceDir: (dirPath) => ipcRenderer.invoke('set-source-dir', dirPath),
  // Save a base64-encoded file to a specific path (bypasses Chromium download manager)
  saveBase64File: (base64Data, fileName, mimeType) =>
    ipcRenderer.invoke('save-base64-file', base64Data, fileName, mimeType),
  // Open native directory picker dialog
  selectDirectory: () => ipcRenderer.invoke('select-directory')
});