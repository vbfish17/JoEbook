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
    PORT: '3000'
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

  // Give local server a 1.5 seconds head start to bind to port 3000
  setTimeout(() => {
    mainWindow.loadURL('http://localhost:3000').catch((err) => {
      console.warn('Initial connection failed, retrying...', err);
      // Wait another second and try one more time
      setTimeout(() => {
        mainWindow.loadURL('http://localhost:3000');
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
