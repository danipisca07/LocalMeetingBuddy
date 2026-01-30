const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');
const { EventEmitter } = require('events');

class TranscriptionService extends EventEmitter {
  constructor(apiKey) {
    super();
    if (!apiKey) throw new Error('Deepgram API key is required');
    this.client = createClient(apiKey);
    this.connection = null;
    this.keepAliveInterval = null;
    this.source = null;
  }

  connect(sampleRate = 16000, source = null) {
    const language = process.env.DEEPGRAM_LANGUAGE || 'it';
    console.log(`Connecting to Deepgram with language: ${language}`);
    this.source = source;
    
    this.connection = this.client.listen.live({
      model: 'nova-2',
      language: language,
      smart_format: true,
      encoding: 'linear16',
      channels: 1,
      sample_rate: sampleRate,
      interim_results: true,
      utterance_end_ms: 1000,
      vad_events: true,
    });

    this.connection.on(LiveTranscriptionEvents.Open, () => {
      console.log('Deepgram connection opened.');
      this.emit('connected');
      this.keepAliveInterval = setInterval(() => {
        if (this.connection && this.connection.getReadyState() === 1) {
          this.connection.keepAlive();
        }
      }, 10000);
    });

    this.connection.on(LiveTranscriptionEvents.Close, () => {
      console.log('Deepgram connection closed.');
      this.emit('disconnected');
      clearInterval(this.keepAliveInterval);
    });

    this.connection.on(LiveTranscriptionEvents.Transcript, (data) => {
      const transcript = data.channel.alternatives[0].transcript;
      const confidence = data.channel.alternatives[0].confidence;
      const ts = Date.now();
      if (transcript && data.is_final) {
        this.emit('transcription', { text: transcript, confidence, timestamp: ts, source: this.source });
      }
    });

    this.connection.on(LiveTranscriptionEvents.Error, (err) => {
      console.error('Deepgram error:', err);
      this.emit('error', err);
    });
  }

  sendAudio(buffer) {
    if (this.connection && this.connection.getReadyState() === 1) {
      this.connection.send(buffer);
    }
  }

  disconnect() {
    if (this.connection) {
      this.connection.finish();
      this.connection = null;
    }
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }
}

module.exports = TranscriptionService;
