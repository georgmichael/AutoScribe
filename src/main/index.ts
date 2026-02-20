import { app, BrowserWindow } from 'electron';
import squirrelStartup from 'electron-squirrel-startup';
import { registerIpcHandlers } from './ipc/handlers';

if (squirrelStartup) {
  app.quit();
}

// Prevent unhandled errors from crashing the app
process.on('uncaughtException', (err) => {
  console.error('[Main] Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Main] Unhandled rejection:', reason);
});

declare const CONTROL_WINDOW_WEBPACK_ENTRY: string;
declare const CONTROL_WINDOW_PRELOAD_WEBPACK_ENTRY: string;
declare const DISPLAY_WINDOW_WEBPACK_ENTRY: string;
declare const DISPLAY_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

let controlWindow: BrowserWindow | null = null;
let displayWindow: BrowserWindow | null = null;

function createControlWindow(): void {
  controlWindow = new BrowserWindow({
    width: 900,
    height: 700,
    title: 'AutoScribe - Control Panel',
    webPreferences: {
      preload: CONTROL_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  controlWindow.loadURL(CONTROL_WINDOW_WEBPACK_ENTRY);

  // Block DevTools in production builds
  if (process.env.NODE_ENV !== 'development') {
    controlWindow.webContents.on('devtools-opened', () => {
      controlWindow?.webContents.closeDevTools();
    });
  }

  controlWindow.on('closed', () => {
    controlWindow = null;
    // Close display window when control panel closes
    if (displayWindow && !displayWindow.isDestroyed()) {
      displayWindow.close();
    }
  });
}

export function createDisplayWindow(): void {
  if (displayWindow && !displayWindow.isDestroyed()) {
    displayWindow.focus();
    return;
  }

  displayWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    title: 'AutoScribe - Display',
    webPreferences: {
      preload: DISPLAY_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  displayWindow.loadURL(DISPLAY_WINDOW_WEBPACK_ENTRY);

  displayWindow.on('closed', () => {
    displayWindow = null;
  });
}

export function closeDisplayWindow(): void {
  if (displayWindow && !displayWindow.isDestroyed()) {
    displayWindow.close();
    displayWindow = null;
  }
}

export function getDisplayWindow(): BrowserWindow | null {
  return displayWindow;
}

export function getControlWindow(): BrowserWindow | null {
  return controlWindow;
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createControlWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createControlWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
