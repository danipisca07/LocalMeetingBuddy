import type { TranscriptionService } from './TranscriptionService.ts';
import { DeepgramTranscriptionService } from './DeepgramTranscriptionService.ts';
import { LocalTranscriptionService } from './LocalTranscriptionService.ts';

export type { TranscriptionService, TranscriptionEvent } from './TranscriptionService.ts';
export { DeepgramTranscriptionService } from './DeepgramTranscriptionService.ts';
export { LocalTranscriptionService } from './LocalTranscriptionService.ts';

/**
 * Creates the configured transcription provider. Selected via
 * TRANSCRIPTION_PROVIDER ('deepgram' | 'local'); defaults to Deepgram.
 * The local provider runs fully on-device and needs no API key.
 */
export function createTranscriptionService(apiKey?: string): TranscriptionService {
  const provider = (process.env.TRANSCRIPTION_PROVIDER || 'deepgram').toLowerCase();
  switch (provider) {
    case 'local':
      return new LocalTranscriptionService();
    case 'deepgram':
      return new DeepgramTranscriptionService(apiKey as string);
    default:
      throw new Error(`Unknown TRANSCRIPTION_PROVIDER "${provider}" (expected 'deepgram' or 'local')`);
  }
}
