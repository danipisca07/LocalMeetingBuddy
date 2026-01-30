const Anthropic = require('@anthropic-ai/sdk');

class ClaudeClient {
  constructor(apiKey) {
    if (!apiKey) throw new Error('Anthropic API key is required');
    this.anthropic = new Anthropic({ apiKey });
    this.transcript = [];
    this.chatHistory = [];
    this.systemPrompt = "You are an AI meeting assistant. You will receive real-time transcripts labeled by source (user or caller). Use this context to answer user questions accurately and concisely.";
    this.isProcessing = false;
    this.queue = [];
  }

  addTranscriptEntry(entry) {
    const ts = entry.timestamp || Date.now();
    const row = {
      timestamp: ts,
      source: entry.source || 'unknown',
      text: entry.text || '',
      confidence: entry.confidence
    };
    this.transcript.push(row);
    this.transcript.sort((a, b) => a.timestamp - b.timestamp);
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
      const currentTranscript = this.transcript.map(r => {
        const timeStr = new Date(r.timestamp).toLocaleTimeString();
        const confStr = r.confidence !== undefined ? ` (conf=${r.confidence.toFixed(2)})` : '';
        return `[${timeStr}] [${r.source}]${confStr} ${r.text}`;
      }).join('\n');
      const dynamicSystemPrompt = `${this.systemPrompt}\n\n=== MEETING TRANSCRIPT ===\n${currentTranscript}\n=== END TRANSCRIPT ===`;

      const messages = [...this.chatHistory, { role: 'user', content: userText }];

      //const response = messages.map(m => `${m.role}: ${m.content}`).join('\n')
      const response = await this.anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 1024,
        system: dynamicSystemPrompt,
        messages
      });

      const reply = response.content[0].text;
      
      this.chatHistory.push({ role: 'user', content: userText });
      this.chatHistory.push({ role: 'assistant', content: reply });

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

  getTranscript() {
    return this.transcript.map(r => {
      const timeStr = new Date(r.timestamp).toLocaleTimeString();
      const confStr = r.confidence !== undefined ? ` (conf=${r.confidence.toFixed(2)})` : '';
      return `[${timeStr}] [${r.source}]${confStr} ${r.text}`;
    }).join('\n');
  }
}

module.exports = ClaudeClient;
