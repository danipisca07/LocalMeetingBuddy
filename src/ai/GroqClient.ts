import Groq from 'groq-sdk';
import { BaseAIService } from './BaseAIService.ts';
import type { ChatMessage, TranscriptStore } from './AIService.ts';

/** AI provider backed by Groq's OpenAI-compatible chat completions API. */
export class GroqClient extends BaseAIService {
  private readonly groq: Groq;

  constructor(transcriptManager: TranscriptStore) {
    super(transcriptManager, 'Groq');

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      console.error('Error: GROQ_API_KEY must be set in .env');
      process.exit(1);
    }
    this.groq = new Groq({ apiKey });
  }

  protected async complete(history: ChatMessage[], systemPrompt: string): Promise<string> {
    const response = await this.groq.chat.completions.create({
      model: process.env.GROQ_MODEL_ID || 'llama3-8b-8192',
      max_tokens: parseInt(process.env.GROQ_MAX_TOKENS ?? '', 10) || 1024,
      // Groq (OpenAI-compatible) expects the system prompt as the first message.
      messages: [
        { role: 'system' as const, content: systemPrompt },
        ...history.map((m) =>
          m.role === 'assistant'
            ? { role: 'assistant' as const, content: m.content }
            : { role: 'user' as const, content: m.content }
        ),
      ],
    });

    return response.choices[0]?.message?.content ?? '';
  }
}
