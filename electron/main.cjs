const { app, BrowserWindow } = require('electron');
const path = require('path');
const { fork } = require('child_process');

let serverProcess = null;
let mainWindow = null;

function startServer() {
  // Spawn the compiled Express standalone server as a fork child process
  const serverPath = path.join(__dirname, '..', 'dist', 'server.cjs');
  
  // Set production environment variables
  const env = { 
    ...process.env, 
    NODE_ENV: 'production',
    PORT: '7050'
  };

  console.log('Spawning JoEbook local background server:', serverPath);
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
    },
    icon: path.join(__dirname, '..', 'public', 'favicon.ico')
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
