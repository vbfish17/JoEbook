const { app, BrowserWindow, ipcMain, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { fork } = require('child_process');

let serverProcess = null;
let mainWindow = null;

// Resolve real filesystem path for asar-unpacked resources.
// Electron bundles app code into app.asar, but fork() creates a standard
// Node.js child process that cannot read the .asar virtual filesystem.
function realScriptPath(p) {
  if (p.includes('app.asar')) {
    const unpacked = p.replace('app.asar', 'app.asar.unpacked');
    if (fs.existsSync(unpacked)) return unpacked;
  }
  return p;
}

function realAppRoot() {
  const appRoot = path.join(__dirname, '..');
  if (appRoot.includes('app.asar')) {
    const unpacked = appRoot.replace('app.asar', 'app.asar.unpacked');
    if (fs.existsSync(path.join(unpacked, 'dist', 'server.cjs'))) return unpacked;
  }
  return appRoot;
}

// IPC: Save path management
let userSavePath = '';
let sourceDir = ''; // auto-detected from source file (DMG only)
ipcMain.handle('get-save-path', () => {
  return userSavePath || '';
});
ipcMain.handle('set-save-path', (_event, savePath) => {
  userSavePath = savePath;
  return true;
});
ipcMain.handle('set-source-dir', (_event, dirPath) => {
  sourceDir = dirPath || '';
  console.log('[set-source-dir] sourceDir set to:', sourceDir);
  return true;
});

// IPC: Save base64-encoded file to the correct save path directory
ipcMain.handle('save-base64-file', async (_event, base64Data, fileName, mimeType) => {
  const defaultDir = app.getPath('downloads');
  const targetDir = userSavePath || sourceDir || defaultDir;
  
  console.log('[save-base64-file] userSavePath:', userSavePath, 'sourceDir:', sourceDir, 'targetDir:', targetDir, 'fileName:', fileName);
  
  if (!fs.existsSync(targetDir)) {
    try { fs.mkdirSync(targetDir, { recursive: true }); } catch (_) {}
  }
  
  const filePath = path.join(targetDir, fileName);
  const buffer = Buffer.from(base64Data, 'base64');
  fs.writeFileSync(filePath, buffer);
  console.log('Base64 file saved to:', filePath);
  return filePath;
});

// IPC: Open native directory picker dialog
ipcMain.handle('select-directory', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '选择文件保存目录'
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

function startServer() {
  // Spawn the compiled Express standalone server as a fork child process.
  //
  // KEY INSIGHT: Electron's fork() creates a standard Node.js child process
  // that cannot read from the .asar virtual filesystem. To work around this:
  // 1. "dist/**/*" is in asarUnpack so server.cjs + frontend assets live on
  //    the real filesystem under app.asar.unpacked/dist/.
  // 2. We use realAppRoot() to resolve the real filesystem path for server.cjs.
  // 3. We set NODE_PATH to BOTH unpacked node_modules AND asar node_modules.
  //    - unpacked: has native modules (@napi-rs/canvas, lightningcss, etc.)
  //    - asar: has all JS modules (express, jszip, multer, etc.)
  //    Electron's built-in Node.js in the fork'd child CAN resolve .asar
  //    paths because it inherits Electron's asar-aware require() patches.
  const appRoot = realAppRoot();
  const serverPath = path.join(appRoot, 'dist', 'server.cjs');
  
  // NODE_PATH: combine unpacked + asar node_modules
  const asarRoot = path.join(__dirname, '..');
  const unpackedModules = path.join(appRoot, 'node_modules');
  const asarModules = path.join(asarRoot, 'node_modules');
  const nodePath = [unpackedModules, asarModules].join(path.delimiter);

  const env = { 
    ...process.env, 
    NODE_ENV: 'production',
    PORT: '7050',
    NODE_PATH: nodePath,
  };

  console.log('Spawning JoEbook local background server:', serverPath);
  console.log('[startServer] appRoot:', appRoot);
  console.log('[startServer] NODE_PATH:', nodePath);
  serverProcess = fork(serverPath, [], { env, silent: false });

  serverProcess.on('error', (err) => {
    console.error('Failed to start JoEbook server process:', err);
  });

  serverProcess.on('exit', (code, signal) => {
    console.log(`JoEbook server exited with code ${code} and signal ${signal}`);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 900,
    title: 'JoEbook',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '..', 'build', 'icon.icns')
  });

  // Intercept downloads: save without prompting dialog
  mainWindow.webContents.session.on('will-download', (_event, item) => {
    const defaultDir = app.getPath('downloads');
    // Priority: custom path > source file directory > Downloads
    const targetDir = userSavePath || sourceDir || defaultDir;
    
    if (!fs.existsSync(targetDir)) {
      try { fs.mkdirSync(targetDir, { recursive: true }); } catch (_) {}
    }
    
    const filePath = path.join(targetDir, item.getFilename());
    item.setSavePath(filePath);
    
    item.on('done', (_event, state) => {
      if (state === 'completed') {
        console.log('Download completed:', filePath);
      }
    });
  });

  // Give local server a head start to bind to port 7050
  setTimeout(() => {
    mainWindow.loadURL('http://127.0.0.1:7050').catch((err) => {
      console.warn('Initial connection failed, retrying...', err);
      setTimeout(() => {
        mainWindow.loadURL('http://127.0.0.1:7050');
      }, 1500);
    });
  }, 1500);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  startServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Terminate child express backend server when the app is quitting
app.on('will-quit', () => {
  if (serverProcess) {
    console.log('Stopping JoEbook background server process...');
    serverProcess.kill('SIGTERM');
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
