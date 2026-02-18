import { TranscriptSegment } from '../../shared/types/transcript';

/**
 * Circular buffer for transcript segments.
 * Stores the most recent segments in memory and supports export.
 */
export class TranscriptBuffer {
  private segments: TranscriptSegment[] = [];
  private readonly maxSegments: number;

  constructor(maxSegments = 1000) {
    this.maxSegments = maxSegments;
  }

  add(segment: TranscriptSegment): void {
    this.segments.push(segment);
    // Trim oldest segments if over capacity
    if (this.segments.length > this.maxSegments) {
      this.segments = this.segments.slice(this.segments.length - this.maxSegments);
    }
  }

  getAll(): TranscriptSegment[] {
    return [...this.segments];
  }

  getRecent(count: number): TranscriptSegment[] {
    return this.segments.slice(-count);
  }

  clear(): void {
    this.segments = [];
  }

  get length(): number {
    return this.segments.length;
  }

  /**
   * Export as plain text, one segment per line.
   */
  exportText(): string {
    return this.segments
      .filter((s) => s.isFinal)
      .map((s) => s.text)
      .join('\n');
  }

  /**
   * Export as timestamped text.
   */
  exportTimestamped(): string {
    return this.segments
      .filter((s) => s.isFinal)
      .map((s) => {
        const time = new Date(s.timestamp).toLocaleTimeString();
        return `[${time}] ${s.text}`;
      })
      .join('\n');
  }
}
