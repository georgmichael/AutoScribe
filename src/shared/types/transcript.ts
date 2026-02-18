export interface TranscriptSegment {
  id: string;
  text: string;
  timestamp: number;
  confidence: number;
  isFinal: boolean;
  displayedAt?: number;
}

export interface TranscriptSession {
  id: string;
  name: string;
  startTime: number;
  endTime?: number;
  segments: TranscriptSegment[];
}
