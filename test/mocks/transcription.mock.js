const { EventEmitter } = require('events');

class MockTranscriptionService extends EventEmitter {
  constructor(apiKey) {
    super();
    if (!apiKey) throw new Error('Deepgram API key is required');
    this.connected = false;
  }

  connect(sampleRate, source) {
    this.connected = true;
    process.nextTick(() => {
        this.emit('connected');
    });
  }

  disconnect() {
    this.connected = false;
    this.emit('disconnected');
  }

  sendAudio(buffer) {
    if (!this.connected) {
      // throw new Error('Not connected');
      // Real service might silently fail or queue, but let's just ignore for mock
      return;
    }
    // Simulate getting a transcript back occasionally
    if (Math.random() > 0.9) {
      this.emit('transcription', {
        text: 'Hello world',
        confidence: 0.99,
        timestamp: Date.now(),
        source: 'mock'
      });
    }
  }
}

module.exports = MockTranscriptionService;
