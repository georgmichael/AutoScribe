import { ipcMain, dialog } from 'electron';
import { writeFile } from 'fs/promises';
import { v4 as uuid } from 'uuid';
import { IPC_CHANNELS, SessionStatus, PacedSegment } from '../../shared/types/ipc';
import { DEFAULT_SETTINGS, AudioSettings, PacingSettings } from '../../shared/types/settings';
import { TranscriptSegment } from '../../shared/types/transcript';
import { AudioCaptureManager } from '../audio/AudioCaptureManager';
import { WhisperEngine, WhisperTask } from '../stt/WhisperEngine';
import { STTResult } from '../stt/STTEngine';
import { PacingController } from '../transcript/PacingController';
import { TranscriptBuffer } from '../transcript/TranscriptBuffer';
import { NetworkServer } from '../server/NetworkServer';
import { createDisplayWindow, closeDisplayWindow, getControlWindow, getDisplayWindow } from '../index';

const audioCapture = new AudioCaptureManager();
const sttEngine = new WhisperEngine();
const pacingController = new PacingController();
const transcriptBuffer = new TranscriptBuffer();
const networkServer = new NetworkServer();

let sessionStatus: SessionStatus = 'idle';
let currentAudioSettings: AudioSettings = { ...DEFAULT_SETTINGS.audio };
let sttReady = false;

// Initialize STT engine on startup
(async () => {
  try {
    console.log('Initializing Whisper STT engine...');
    await sttEngine.init();
    sttReady = true;
    console.log('Whisper STT engine ready');
  } catch (err) {
    console.error('Failed to initialize STT engine:', err);
  }
})();

// STT result -> buffer + control window (always instant) + pacing controller (for display)
sttEngine.on('result', (result: STTResult) => {
  const segment: TranscriptSegment = {
    id: uuid(),
    text: result.text,
    timestamp: Date.now(),
    confidence: result.confidence,
    isFinal: result.isFinal,
  };

  // Store in buffer
  transcriptBuffer.add(segment);

  // Control window always gets text immediately (operator view)
  const control = getControlWindow();
  if (control && !control.isDestroyed()) {
    control.webContents.send(IPC_CHANNELS.TRANSCRIPT_SEGMENT, segment);
  }

  // Display window gets text through the pacing controller
  pacingController.enqueue(segment);
});

// Paced output -> display window + network viewers
pacingController.on('paced', (paced: PacedSegment) => {
  const display = getDisplayWindow();
  if (display && !display.isDestroyed()) {
    display.webContents.send(IPC_CHANNELS.TRANSCRIPT_SEGMENT, paced);
  }
  // Broadcast to network viewers
  if (networkServer.isRunning) {
    networkServer.broadcastSegment(paced);
  }
});

sttEngine.on('error', (err: Error) => {
  console.error('STT error:', err.message);
});

sttEngine.on('status', (msg: string) => {
  console.log('STT status:', msg);
});

export function getAudioCapture(): AudioCaptureManager {
  return audioCapture;
}

export function registerIpcHandlers(): void {
  // Display window controls
  ipcMain.on(IPC_CHANNELS.DISPLAY_OPEN, () => {
    createDisplayWindow();
  });

  ipcMain.on(IPC_CHANNELS.DISPLAY_CLOSE, () => {
    closeDisplayWindow();
  });

  // Settings
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, async () => {
    return DEFAULT_SETTINGS;
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_UPDATE, async (_event, settings) => {
    if (settings.audio) {
      currentAudioSettings = { ...currentAudioSettings, ...settings.audio };
    }
    if (settings.pacing) {
      pacingController.updateSettings(settings.pacing);
    }
    if (settings.display) {
      // Forward display settings to display window
      const display = getDisplayWindow();
      if (display && !display.isDestroyed()) {
        display.webContents.send(IPC_CHANNELS.SETTINGS_DISPLAY_UPDATE, settings.display);
      }
      // Forward to network viewers
      if (networkServer.isRunning) {
        networkServer.broadcastSettings(settings.display);
      }
    }
  });

  // Audio devices
  ipcMain.handle(IPC_CHANNELS.AUDIO_DEVICES, async () => {
    return audioCapture.listDevices();
  });

  // Audio test (level only, no transcription)
  let audioTesting = false;
  ipcMain.handle(IPC_CHANNELS.AUDIO_TEST_START, async () => {
    if (sessionStatus !== 'idle' || audioTesting) return;
    audioTesting = true;
    audioCapture.start(currentAudioSettings);
    audioCapture.on('level', (level: number) => {
      const control = getControlWindow();
      if (control && !control.isDestroyed()) {
        control.webContents.send(IPC_CHANNELS.AUDIO_LEVEL, level);
      }
    });
  });

  ipcMain.handle(IPC_CHANNELS.AUDIO_TEST_STOP, async () => {
    if (!audioTesting) return;
    audioCapture.stop();
    audioCapture.removeAllListeners();
    audioTesting = false;
  });

  // Pacing settings (direct update from control panel)
  ipcMain.handle(IPC_CHANNELS.SETTINGS_PACING_UPDATE, async (_event, pacing: PacingSettings) => {
    pacingController.updateSettings(pacing);
  });

  // Session controls
  ipcMain.handle(IPC_CHANNELS.SESSION_START, async () => {
    if (sessionStatus !== 'idle') return sessionStatus;

    // Stop audio test if running
    if (audioTesting) {
      audioCapture.stop();
      audioCapture.removeAllListeners();
      audioTesting = false;
    }

    if (!sttReady) {
      console.warn('STT engine not ready yet, starting audio capture only');
    }

    transcriptBuffer.clear();
    pacingController.clear();

    audioCapture.start(currentAudioSettings);
    sessionStatus = 'recording';

    // Forward audio level to control window
    audioCapture.on('level', (level: number) => {
      const control = getControlWindow();
      if (control && !control.isDestroyed()) {
        control.webContents.send(IPC_CHANNELS.AUDIO_LEVEL, level);
      }
    });

    // Feed audio data to STT engine
    audioCapture.on('data', (chunk: Buffer) => {
      if (sttReady) {
        sttEngine.feedAudio(chunk);
      }
    });

    audioCapture.on('error', (err: Error) => {
      console.error('Audio capture error:', err.message);
    });

    return sessionStatus;
  });

  ipcMain.handle(IPC_CHANNELS.SESSION_STOP, async () => {
    audioCapture.stop();
    audioCapture.removeAllListeners();
    pacingController.stop();

    // Flush any remaining audio in the STT buffer
    if (sttReady) {
      await sttEngine.flush();
    }

    // Clear network viewers
    if (networkServer.isRunning) {
      networkServer.broadcastClear();
    }

    sessionStatus = 'idle';
    return sessionStatus;
  });

  ipcMain.handle(IPC_CHANNELS.SESSION_PAUSE, async () => {
    if (sessionStatus === 'recording') {
      audioCapture.pause();
      sessionStatus = 'paused';
    }
    return sessionStatus;
  });

  ipcMain.handle(IPC_CHANNELS.SESSION_RESUME, async () => {
    if (sessionStatus === 'paused') {
      audioCapture.resume();
      sessionStatus = 'recording';
    }
    return sessionStatus;
  });

  ipcMain.handle(IPC_CHANNELS.SESSION_STATUS, async () => {
    return sessionStatus;
  });

  // STT task (language / translate)
  ipcMain.handle(IPC_CHANNELS.STT_SET_TASK, async (_event, task: WhisperTask) => {
    sttEngine.setTask(task);
  });

  ipcMain.handle(IPC_CHANNELS.STT_GET_TASK, async () => {
    return sttEngine.getTask();
  });

  // Network server
  ipcMain.handle(IPC_CHANNELS.NETWORK_START, async () => {
    return networkServer.start();
  });

  ipcMain.handle(IPC_CHANNELS.NETWORK_STOP, async () => {
    networkServer.stop();
  });

  ipcMain.handle(IPC_CHANNELS.NETWORK_STATUS, async () => {
    return networkServer.getStatus();
  });

  ipcMain.handle(IPC_CHANNELS.NETWORK_QR, async () => {
    return networkServer.getQRCode();
  });

  // Export transcript
  ipcMain.handle(IPC_CHANNELS.TRANSCRIPT_EXPORT, async () => {
    const text = transcriptBuffer.exportTimestamped();
    if (!text) return null;

    const { filePath } = await dialog.showSaveDialog({
      title: 'Export Transcript',
      defaultPath: `autoscribe-${new Date().toISOString().slice(0, 10)}.txt`,
      filters: [{ name: 'Text Files', extensions: ['txt'] }],
    });

    if (filePath) {
      await writeFile(filePath, text, 'utf-8');
      return filePath;
    }
    return null;
  });
}
