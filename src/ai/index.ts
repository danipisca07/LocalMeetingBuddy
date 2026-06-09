import type { AIService, TranscriptStore } from './AIService.ts';
import { ClaudeClient } from './ClaudeClient.ts';
import { GroqClient } from './GroqClient.ts';

export type { AIService, ChatMessage, TranscriptStore } from './AIService.ts';
export { BaseAIService } from './BaseAIService.ts';
export { ClaudeClient } from './ClaudeClient.ts';
export { GroqClient } from './GroqClient.ts';

/**
 * Selects an AI provider from the environment:
 * GROQ_API_KEY -> Groq, else ANTHROPIC_API_KEY -> Claude.
 */
export function createAIService(transcriptManager: TranscriptStore): AIService {
  if (process.env.GROQ_API_KEY) {
    return new GroqClient(transcriptManager);
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return new ClaudeClient(transcriptManager);
  }
  console.error('Error: GROQ_API_KEY or ANTHROPIC_API_KEY must be set in .env');
  process.exit(1);
}
