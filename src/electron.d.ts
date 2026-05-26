// Electron IPC API exposed via preload.js (DMG/desktop only)
interface ElectronAPI {
  getSavePath: () => Promise<string>;
  setSavePath: (savePath: string) => Promise<boolean>;
}

interface Window {
  electronAPI?: ElectronAPI;
}
