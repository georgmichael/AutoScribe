declare module 'node-record-lpcm16' {
  import { Readable } from 'stream';

  interface RecordingOptions {
    sampleRate?: number;
    channels?: number;
    compress?: boolean;
    threshold?: number;
    thresholdStart?: number | null;
    thresholdEnd?: number | null;
    silence?: string;
    recorder?: 'sox' | 'rec' | 'arecord';
    endOnSilence?: boolean;
    audioType?: string;
    device?: string;
  }

  interface Recording {
    stream(): Readable;
    stop(): void;
    pause(): void;
    resume(): void;
    isPaused(): boolean;
    process: import('child_process').ChildProcess;
  }

  function record(options?: RecordingOptions): Recording;

  export { record, Recording, RecordingOptions };
}
