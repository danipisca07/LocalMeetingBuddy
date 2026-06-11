/** Public contract implemented by every AI provider. */
export interface AIService {
  query(userText: string): Promise<string>;
  setUserContext(text: string): void;
}

/** A single turn in the conversation history. */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Minimal structural view of the transcript store consumed by the AI layer,
 * so the services don't depend on the concrete TranscriptManager class.
 */
export interface TranscriptStore {
  getTranscript(): string;
  addTranscriptEntry(timestamp: number, source: string, text: string, confidence?: number): void;
}
