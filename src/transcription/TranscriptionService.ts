import type { EventEmitter } from 'events';

/** A single diarized utterance emitted by a transcription provider. */
export interface TranscriptionEvent {
  text: string;
  speaker?: number;
  confidence: number;
  timestamp: number;
  source: string | null;
}

/** Options for the one-shot batch transcription of a pre-recorded clip. */
export interface BatchTranscribeOptions {
  /** Sample rate of the PCM in `audio` (default 16000). */
  sampleRate?: number;
  /** Label set on every emitted event's `source`. */
  source?: string | null;
  /**
   * Wall-clock milliseconds added to each utterance's in-clip offset, so the
   * emitted `timestamp` orders utterances by their real position in the
   * recording (and interleaves correctly across multiple tracks).
   */
  baseTimestamp?: number;
}

/**
 * Provider-agnostic streaming transcription contract. Implementations are
 * EventEmitters that emit:
 *  - 'connected'                      when the provider stream opens
 *  - 'disconnected'                   when it closes
 *  - 'transcription' (TranscriptionEvent) for each final utterance
 *  - 'error' (Error)                  on provider errors
 */
export interface TranscriptionService extends EventEmitter {
  connect(sampleRate?: number, source?: string | null): void;
  sendAudio(buffer: Buffer): void;
  disconnect(): void;

  /**
   * One-shot batch transcription of a whole PCM16-mono clip.
   */
  transcribeBatch(audio: Buffer, opts?: BatchTranscribeOptions): Promise<void>;

  on(event: 'transcription', listener: (evt: TranscriptionEvent) => void): this;
  on(event: 'connected' | 'disconnected', listener: () => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this;
}
