class TranscriptManager {
  constructor() {
    this.transcript = [];
  }

  addTranscriptEntry(timestamp, source, text, confidence) {
    const ts = timestamp || Date.now();
    const row = {
      timestamp: ts,
      source: source || 'unknown',
      text: text || '',
      confidence: confidence
    };
    this.transcript.push(row);
    this.transcript.sort((a, b) => a.timestamp - b.timestamp);
  }

  getTranscript() {
    return this.transcript.map(r => {
      const timeStr = new Date(r.timestamp).toLocaleTimeString();
      const confStr = r.confidence !== undefined ? ` (conf=${r.confidence.toFixed(2)})` : '';
      return `[${timeStr}] [${r.source}]${confStr} ${r.text}`;
    }).join('\n');
  }
}

module.exports = TranscriptManager;
