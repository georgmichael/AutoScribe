/**
 * Processes raw PCM audio data for level metering and noise gating.
 * Expects 16-bit signed integer PCM (little-endian), mono, as produced
 * by node-record-lpcm16 with audioType: 'wav'.
 */
export class AudioProcessor {
  private readonly WAV_HEADER_SIZE = 44;
  private headerStripped = false;

  /**
   * Calculate the RMS audio level from a PCM buffer.
   * Returns a normalized value between 0 and 1.
   */
  calculateLevel(chunk: Buffer): number {
    // WAV streams from SoX start with a 44-byte header on the first chunk.
    // Skip it so we only process raw PCM samples.
    let offset = 0;
    if (!this.headerStripped) {
      if (chunk.length <= this.WAV_HEADER_SIZE) {
        return 0;
      }
      offset = this.WAV_HEADER_SIZE;
      this.headerStripped = true;
    }

    const samples = (chunk.length - offset) / 2; // 16-bit = 2 bytes per sample
    if (samples <= 0) return 0;

    let sumSquares = 0;
    for (let i = offset; i < chunk.length - 1; i += 2) {
      const sample = chunk.readInt16LE(i);
      const normalized = sample / 32768;
      sumSquares += normalized * normalized;
    }

    const rms = Math.sqrt(sumSquares / samples);
    return Math.min(1, rms);
  }

  /**
   * Reset state (call when starting a new recording session).
   */
  reset(): void {
    this.headerStripped = false;
  }
}
