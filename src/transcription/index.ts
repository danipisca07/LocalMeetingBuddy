import type { TranscriptionService } from './TranscriptionService.ts';
import { DeepgramTranscriptionService } from './DeepgramTranscriptionService.ts';

export type { TranscriptionService, TranscriptionEvent } from './TranscriptionService.ts';
export { DeepgramTranscriptionService } from './DeepgramTranscriptionService.ts';

/** Creates the default transcription provider (Deepgram). */
export function createTranscriptionService(apiKey: string): TranscriptionService {
  return new DeepgramTranscriptionService(apiKey);
}
