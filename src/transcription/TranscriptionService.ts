import type { EventEmitter } from 'events';

/** A single diarized utterance emitted by a transcription provider. */
export interface TranscriptionEvent {
  text: string;
  speaker?: number;
  confidence: number;
  timestamp: number;
  source: string | null;
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

  on(event: 'transcription', listener: (evt: TranscriptionEvent) => void): this;
  on(event: 'connected' | 'disconnected', listener: () => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this;
}
