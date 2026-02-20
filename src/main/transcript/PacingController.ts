import { EventEmitter } from 'events';
import { TranscriptSegment } from '../../shared/types/transcript';
import { PacingSettings, DEFAULT_SETTINGS } from '../../shared/types/settings';
import { PacedSegment } from '../../shared/types/ipc';

/**
 * Controls the rate at which transcript segments are delivered to displays.
 *
 * Modes:
 * - sentence: Buffer complete sentences, release one at a time at WPM rate
 * - streaming: Release word-by-word at exact WPM
 * - instant: No pacing, forward immediately
 */
export class PacingController extends EventEmitter {
  private queue: TranscriptSegment[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private settings: PacingSettings;
  private _isRunning = false;

  constructor(settings?: PacingSettings) {
    super();
    this.settings = settings ?? { ...DEFAULT_SETTINGS.pacing };
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  updateSettings(settings: Partial<PacingSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  /**
   * Add a transcript segment to the pacing queue.
   */
  enqueue(segment: TranscriptSegment): void {
    if (this.settings.mode === 'instant') {
      // Instant mode: emit immediately with no delay
      const paced: PacedSegment = { segment, displayDuration: 0 };
      this.emit('paced', paced);
      return;
    }

    this.queue.push(segment);

    // Start processing if not already running
    if (!this._isRunning) {
      this._isRunning = true;
      this.processNext();
    }
  }

  /**
   * Process the next segment in the queue.
   */
  private processNext(): void {
    if (this.queue.length === 0) {
      this._isRunning = false;
      return;
    }

    const segment = this.queue.shift()!;
    const wordCount = segment.text.split(/\s+/).filter(Boolean).length;

    if (this.settings.mode === 'sentence') {
      // Calculate how long this sentence should be displayed
      // based on WPM: duration = (wordCount / WPM) * 60 seconds
      const durationMs = ((wordCount / this.settings.wpm) * 60 * 1000) + this.settings.sentenceDelay;
      const paced: PacedSegment = { segment, displayDuration: durationMs };
      this.emit('paced', paced);

      // Wait before showing the next segment
      this.timer = setTimeout(() => {
        this.processNext();
      }, durationMs);

    } else if (this.settings.mode === 'streaming') {
      // Streaming mode: emit one word at a time
      const words = segment.text.split(/\s+/).filter(Boolean);
      this.emitWordsSequentially(words, segment, 0);
    }
  }

  /**
   * Emit words one at a time for streaming mode.
   */
  private emitWordsSequentially(
    words: string[],
    originalSegment: TranscriptSegment,
    index: number
  ): void {
    if (index >= words.length) {
      // Done with this segment, process next
      this.processNext();
      return;
    }

    // Build cumulative text up to current word
    const partialText = words.slice(0, index + 1).join(' ');
    const wordSegment: TranscriptSegment = {
      ...originalSegment,
      text: partialText,
      isFinal: index === words.length - 1,
    };

    const intervalMs = (60 / this.settings.wpm) * 1000;
    const paced: PacedSegment = { segment: wordSegment, displayDuration: intervalMs };
    this.emit('paced', paced);

    this.timer = setTimeout(() => {
      this.emitWordsSequentially(words, originalSegment, index + 1);
    }, intervalMs);
  }

  /**
   * Flush all queued segments immediately (e.g., "catch up" button).
   */
  flush(): void {
    this.stop();
    for (const segment of this.queue) {
      const paced: PacedSegment = { segment, displayDuration: 0 };
      this.emit('paced', paced);
    }
    this.queue = [];
  }

  /**
   * Stop pacing and clear the queue.
   */
  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this._isRunning = false;
  }

  /**
   * Clear the queue without emitting remaining segments.
   */
  clear(): void {
    this.stop();
    this.queue = [];
  }

  get queueLength(): number {
    return this.queue.length;
  }
}
