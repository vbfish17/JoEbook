// Electron IPC API exposed via preload.js (DMG/desktop only)
interface ElectronAPI {
  getSavePath: () => Promise<string>;
  setSavePath: (savePath: string) => Promise<boolean>;
  setSourceDir: (dirPath: string) => Promise<boolean>;
  saveBase64File: (base64Data: string, fileName: string, mimeType: string) => Promise<string>;
  selectDirectory: () => Promise<string | null>;
}

interface Window {
  electronAPI?: ElectronAPI;
}