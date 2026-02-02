const Anthropic = require('@anthropic-ai/sdk');

class ClaudeClient {
  /**
   * @param {string} apiKey - The Anthropic API key.
   * @param {TranscriptManager} transcriptManager - The transcript manager instance.
   */
  constructor(transcriptManager) {
    
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      console.error('Error: ANTHROPIC_API_KEY must be set in .env');
      process.exit(1);
    }
    this.anthropic = new Anthropic({ apiKey });
    this.transcriptManager = transcriptManager;
    this.chatHistory = [];
    //eng
    //this.systemPrompt = "You are an AI meeting assistant. You will receive real-time transcripts labeled by source (user or a number representing a caller). Use this context to answer user questions accurately and concisely.";
    //ita
    this.systemPrompt = "Sei un assistente AI di riunione. Riceverai trascrizioni in tempo reale etichettate da sorgente (utente o un numero che rappresenta un chiamante). Utilizza questo contesto per rispondere alle domande dell'utente in modo accurato e conciso.";
    this.isProcessing = false;
    this.queue = [];
  }

  async query(userText) {
    return new Promise((resolve, reject) => {
      this.queue.push({ userText, resolve, reject });
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;

    this.isProcessing = true;
    const { userText, resolve, reject } = this.queue.shift();

    try {
      const currentTranscript = this.transcriptManager.getTranscript()
      const dynamicSystemPrompt = `${this.systemPrompt}\n\n=== TRASCRIZIONE MEETING ===\n${currentTranscript}\n=== FINE TRASCRIZIONE ===`;

      const messages = [...this.chatHistory, { role: 'user', content: userText }];

      this.transcriptManager.addTranscriptEntry(Date.now(), 'user', userText);
      if(process.env.SKIP_LLM === 'true') {
        resolve('SKIPPED LLM');
        return;
      }
      const response = await this.anthropic.messages.create({
        model: process.env.CLAUDE_MODEL_ID,
        max_tokens: 1024,
        system: dynamicSystemPrompt,
        messages
      });
      
      const reply = response.content[0].text;
      
      this.chatHistory.push({ role: 'user', content: userText });
      this.chatHistory.push({ role: 'assistant', content: reply });
      this.transcriptManager.addTranscriptEntry(Date.now(), 'assistant', reply);

      resolve(reply);
    } catch (error) {
      console.error('Claude API Error:', error);
      if (error.status === 429) {
          console.warn("Rate limited. Consider implementing backoff.");
      }
      reject(error);
    } finally {
      this.isProcessing = false;
      if (this.queue.length > 0) {
        setTimeout(() => this.processQueue(), 1000); // 1s delay between messages to be safe
      }
    }
  }
}

module.exports = ClaudeClient;
