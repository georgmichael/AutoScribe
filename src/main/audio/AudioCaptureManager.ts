import { EventEmitter } from 'events';
import { execFile } from 'child_process';
import { promisify } from 'util';
import record from 'node-record-lpcm16';
import { Readable } from 'stream';
import { AudioSettings } from '../../shared/types/settings';
import { AudioDevice } from '../../shared/types/ipc';
import { AudioProcessor } from './AudioProcessor';

const execFileAsync = promisify(execFile);

export interface AudioCaptureEvents {
  data: (chunk: Buffer) => void;
  level: (level: number) => void;
  error: (error: Error) => void;
  started: () => void;
  stopped: () => void;
}

export class AudioCaptureManager extends EventEmitter {
  private recording: ReturnType<typeof record.record> | null = null;
  private stream: Readable | null = null;
  private processor: AudioProcessor;
  private _isRecording = false;

  constructor() {
    super();
    this.processor = new AudioProcessor();
  }

  get isRecording(): boolean {
    return this._isRecording;
  }

  start(settings: AudioSettings): void {
    if (this._isRecording) {
      this.stop();
    }

    try {
      // On macOS, SoX uses AUDIODEV env var for device selection
      if (process.platform === 'darwin') {
        if (settings.deviceId && settings.deviceId !== 'default') {
          process.env.AUDIODEV = settings.deviceId;
        } else {
          delete process.env.AUDIODEV;
        }
      }

      // Determine device param (used on Linux/Windows, not macOS)
      const deviceParam = (process.platform !== 'darwin' && settings.deviceId && settings.deviceId !== 'default')
        ? settings.deviceId
        : undefined;

      this.recording = record.record({
        sampleRate: settings.sampleRate,
        channels: 1,
        audioType: 'wav',
        recorder: 'sox',
        threshold: settings.noiseGate ? settings.noiseThreshold : 0,
        silence: '2.0',
        endOnSilence: false,
        device: deviceParam,
      });

      this.stream = this.recording.stream();
      this._isRecording = true;

      this.stream.on('data', (chunk: Buffer) => {
        // Calculate audio level for the meter
        const level = this.processor.calculateLevel(chunk);
        this.emit('level', level);

        // Always forward audio to STT - let the engine handle silence
        this.emit('data', chunk);
      });

      this.stream.on('error', (err: Error) => {
        console.error('[Audio] Stream error:', err.message);
        this._isRecording = false;
        this.emit('error', err);
      });

      this.stream.on('end', () => {
        this._isRecording = false;
        this.emit('stopped');
      });

      // Handle the child process crashing
      const proc = (this.recording as any)?.process;
      if (proc) {
        proc.on('exit', (code: number | null) => {
          if (code !== 0 && this._isRecording) {
            console.error(`[Audio] SoX process exited with code ${code}`);
            this._isRecording = false;
            this.emit('error', new Error(`Audio capture process exited unexpectedly (code ${code})`));
            this.emit('stopped');
          }
        });
      }

      this.emit('started');
    } catch (err) {
      this._isRecording = false;
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  stop(): void {
    if (this.recording) {
      try {
        this.recording.stop();
      } catch {
        // Process may already be dead
      }
      this.recording = null;
      this.stream = null;
      this._isRecording = false;
      delete process.env.AUDIODEV;
      this.emit('stopped');
    }
  }

  pause(): void {
    if (this.recording && this._isRecording) {
      this.recording.pause();
    }
  }

  resume(): void {
    if (this.recording) {
      this.recording.resume();
    }
  }

  async listDevices(): Promise<AudioDevice[]> {
    const platform = process.platform;
    try {
      if (platform === 'darwin') {
        return await this.listDevicesMacOS();
      } else if (platform === 'linux') {
        return await this.listDevicesLinux();
      } else if (platform === 'win32') {
        return await this.listDevicesWindows();
      }
    } catch (err) {
      console.error('Failed to enumerate audio devices:', err);
    }
    return [{ deviceId: 'default', label: 'Default Microphone', kind: 'audioinput' }];
  }

  private async listDevicesMacOS(): Promise<AudioDevice[]> {
    const { stdout } = await execFileAsync('system_profiler', ['SPAudioDataType']);
    const devices: AudioDevice[] = [
      { deviceId: 'default', label: 'System Default', kind: 'audioinput' },
    ];

    // Parse device blocks - each starts with a name followed by indented properties
    const blocks = stdout.split(/\n(?=\s{8}\S)/);
    for (const block of blocks) {
      const nameMatch = block.match(/^\s{8}(.+?):\s*$/m);
      if (!nameMatch) continue;

      const name = nameMatch[1].trim();
      const hasInput = /Input Channels:\s*\d+/i.test(block);
      if (!hasInput) continue;

      devices.push({
        deviceId: name,
        label: name,
        kind: 'audioinput',
      });
    }

    return devices;
  }

  private async listDevicesLinux(): Promise<AudioDevice[]> {
    const devices: AudioDevice[] = [
      { deviceId: 'default', label: 'System Default', kind: 'audioinput' },
    ];

    try {
      const { stdout } = await execFileAsync('arecord', ['-l']);
      // Parse lines like: card 0: PCH [HDA Intel PCH], device 0: ALC269VC Analog [ALC269VC Analog]
      const lines = stdout.split('\n');
      for (const line of lines) {
        const match = line.match(/^card\s+(\d+):\s+\S+\s+\[(.+?)\],\s+device\s+(\d+):\s+(.+?)\s+\[/);
        if (match) {
          const [, card, cardName, device, deviceName] = match;
          devices.push({
            deviceId: `hw:${card},${device}`,
            label: `${cardName} - ${deviceName}`,
            kind: 'audioinput',
          });
        }
      }
    } catch {
      // arecord not available, try pactl
      try {
        const { stdout } = await execFileAsync('pactl', ['list', 'sources', 'short']);
        for (const line of stdout.trim().split('\n')) {
          const parts = line.split('\t');
          if (parts.length >= 2) {
            devices.push({
              deviceId: parts[1],
              label: parts[1].replace(/_/g, ' '),
              kind: 'audioinput',
            });
          }
        }
      } catch {
        // No enumeration available
      }
    }

    return devices;
  }

  private async listDevicesWindows(): Promise<AudioDevice[]> {
    const devices: AudioDevice[] = [
      { deviceId: 'default', label: 'System Default', kind: 'audioinput' },
    ];

    try {
      const script = 'Get-WmiObject Win32_SoundDevice | Select-Object Name, DeviceID | ConvertTo-Json';
      const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', script]);
      const parsed = JSON.parse(stdout);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (item?.Name) {
          devices.push({
            deviceId: item.DeviceID || item.Name,
            label: item.Name,
            kind: 'audioinput',
          });
        }
      }
    } catch {
      // PowerShell not available or failed
    }

    return devices;
  }
}
