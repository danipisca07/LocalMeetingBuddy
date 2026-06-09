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
      diarize: true,
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
      
      if (transcript && data.is_final) {
        const list = data.channel.alternatives[0].words.map(w => ({ speaker: w.speaker, word: w.word }));
        //join all words from the same speaker
        var phrases = list.reduce((acc, cur) => {
          if (acc.length === 0 || acc[acc.length - 1].speaker !== cur.speaker) {
            acc.push({ speaker: cur.speaker, words: [cur.word] });
          } else {
            acc[acc.length - 1].words.push(cur.word);
          }
          return acc;
        }, []);
        const ts = Date.now();
        //this.emit('transcription', { text: transcript, confidence, timestamp: ts, source: this.source });
        
        //console.log(phrases.map(p => `${p.speaker}: ${p.words.join(' ')}`).join('\n'))
        phrases.forEach(x => this.emit('transcription', { text: x.words.join(' '), speaker: x.speaker, confidence, timestamp: ts, source: this.source }));
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
