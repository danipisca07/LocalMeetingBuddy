import ChatHistoryManager from '../chat-history-manager.js';
import type { AIService, ChatMessage, TranscriptStore } from './AIService.ts';

interface QueuedQuery {
  userText: string;
  resolve: (reply: string) => void;
  reject: (error: unknown) => void;
}

/**
 * Shared logic for every AI provider: a serialized request queue, chat-history
 * and transcript wiring, dynamic system-prompt assembly and SKIP_LLM handling.
 * Concrete providers only implement {@link complete}.
 */
export abstract class BaseAIService implements AIService {
  protected readonly transcriptManager: TranscriptStore;
  protected readonly chatHistoryManager: ChatHistoryManager;
  protected readonly providerName: string;
  protected systemPrompt =
    "Sei un assistente AI di riunione. Riceverai trascrizioni in tempo reale etichettate da sorgente (utente o un numero che rappresenta un chiamante). Utilizza questo contesto per rispondere alle domande dell'utente in modo accurato e conciso.";

  private isProcessing = false;
  private readonly queue: QueuedQuery[] = [];
  private userContext = '';

  constructor(transcriptManager: TranscriptStore, providerName: string) {
    this.transcriptManager = transcriptManager;
    this.providerName = providerName;
    this.chatHistoryManager = new ChatHistoryManager();
  }

  /**
   * User-supplied extra context (agenda, participants, goals…) injected into
   * the system prompt of every subsequent query. Empty string disables it.
   */
  setUserContext(text: string): void {
    this.userContext = (text ?? '').trim();
  }

  query(userText: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.queue.push({ userText, resolve, reject });
      void this.processQueue();
    });
  }

  /**
   * Provider-specific completion. Receives the normalized conversation (prior
   * history plus the current user message) and the fully-assembled system prompt.
   */
  protected abstract complete(history: ChatMessage[], systemPrompt: string): Promise<string>;

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) return;

    this.isProcessing = true;
    const { userText, resolve, reject } = this.queue.shift()!;

    try {
      const currentTranscript = this.transcriptManager.getTranscript();
      const contextBlock = this.userContext
        ? `\n\n=== CONTESTO FORNITO DALL'UTENTE ===\n${this.userContext}\n=== FINE CONTESTO ===`
        : '';
      const dynamicSystemPrompt =
        `${this.systemPrompt}${contextBlock}\n\n=== TRASCRIZIONE MEETING ===\n${currentTranscript}\n=== FINE TRASCRIZIONE ===`;

      const history: ChatMessage[] = [
        ...this.chatHistoryManager.getHistory(),
        { role: 'user', content: userText },
      ].filter((m: ChatMessage) => m != null && m.content != null && m.content.trim() !== '');

      this.transcriptManager.addTranscriptEntry(Date.now(), 'user', userText);

      if (process.env.SKIP_LLM === 'true') {
        resolve('SKIPPED LLM');
        return;
      }

      const reply = await this.complete(history, dynamicSystemPrompt);

      this.chatHistoryManager.addMessage('user', userText);
      this.chatHistoryManager.addMessage('assistant', reply);
      this.transcriptManager.addTranscriptEntry(Date.now(), 'assistant', reply);

      resolve(reply);
    } catch (error) {
      console.error(`${this.providerName} API Error:`, error);
      if ((error as { status?: number } | null)?.status === 429) {
        console.warn('Rate limited. Consider implementing backoff.');
      }
      reject(error);
    } finally {
      this.isProcessing = false;
      if (this.queue.length > 0) {
        setTimeout(() => void this.processQueue(), 1000); // 1s delay between messages to be safe
      }
    }
  }
}
