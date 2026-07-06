import Anthropic from '@anthropic-ai/sdk';
import { BaseAIService } from './BaseAIService.ts';
import type { ChatMessage, TranscriptStore } from './AIService.ts';

/** AI provider backed by Anthropic's Claude models. */
export class ClaudeClient extends BaseAIService {
  private readonly anthropic: Anthropic;

  constructor(transcriptManager: TranscriptStore) {
    super(transcriptManager, 'Claude');

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error('Error: ANTHROPIC_API_KEY must be set in .env');
      process.exit(1);
    }
    this.anthropic = new Anthropic({ apiKey });
  }

  protected async complete(history: ChatMessage[], systemPrompt: string): Promise<string> {
    // Stream the response: with a high max_tokens the SDK estimates the request
    // may exceed its 10-minute non-streaming limit and requires streaming.
    // finalMessage() accumulates the deltas so the return contract is unchanged.
    const stream = this.anthropic.messages.stream({
      model: process.env.CLAUDE_MODEL_ID ?? '',
      max_tokens: parseInt(process.env.CLAUDE_MAX_TOKENS ?? '', 10) || 1024,
      // Claude takes the system prompt as a top-level field, not a message.
      system: systemPrompt,
      messages: history.map((m) =>
        m.role === 'assistant'
          ? { role: 'assistant' as const, content: m.content }
          : { role: 'user' as const, content: m.content }
      ),
    });

    const message = await stream.finalMessage();
    const first = message.content[0];
    return first && first.type === 'text' ? first.text : '';
  }
}
