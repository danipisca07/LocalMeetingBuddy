const Groq = require('groq-sdk');
const ChatHistoryManager = require('./chat-history-manager');

class GroqClient {
  /**
   * @param {TranscriptManager} transcriptManager - The transcript manager instance.
   */
  constructor(transcriptManager) {
    
    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
      console.error('Error: GROQ_API_KEY must be set in .env');
      process.exit(1);
    }
    this.groq = new Groq({ apiKey });
    this.transcriptManager = transcriptManager;
    this.chatHistoryManager = new ChatHistoryManager();
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

      // Groq (OpenAI-compatible) expects system prompt as the first message
      const messages = [
        { role: 'system', content: dynamicSystemPrompt },
        ...this.chatHistoryManager.getHistory(),
        { role: 'user', content: userText }
      ];

      this.transcriptManager.addTranscriptEntry(Date.now(), 'user', userText);
      if(process.env.SKIP_LLM === 'true') {
        resolve('SKIPPED LLM');
        return;
      }
      
      const response = await this.groq.chat.completions.create({
        messages: messages,
        model: process.env.GROQ_MODEL_ID || "llama3-8b-8192",
        max_tokens: process.env.GROQ_MAX_TOKENS || 1024,
      });
      
      const reply = response.choices[0]?.message?.content || "";
      
      this.chatHistoryManager.addMessage('user', userText);
      this.chatHistoryManager.addMessage('assistant', reply);
      this.transcriptManager.addTranscriptEntry(Date.now(), 'assistant', reply);

      resolve(reply);
    } catch (error) {
      console.error('Groq API Error:', error);
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

module.exports = GroqClient;
