const { EventEmitter } = require('events');
const { DeviceManager } = require('./device-manager');
const TranscriptManager = require('./transcript-manager');
const { createAIService } = require('./ai');
const { determineDisplaySource } = require('./utils');
const { saveMeetingOutputs } = require('./meeting-output');

class MeetingSession extends EventEmitter {
  /**
   * @param {{
   *   transcriptionProvider?: string,   // default: env TRANSCRIPTION_PROVIDER or 'deepgram'
   *   deepgramApiKey?: string,
   *   isLiveMeeting?: boolean,
   *   audioDeviceIdMic?: string,
   *   audioDeviceIdSystem?: string,
   *   sampleRate?: number,              // default 16000
   *   confidenceThreshold?: number,     // default 0.85
   *   skipLlm?: boolean,
   * }} config
   */
  constructor(config = {}) {
    super();
    this.config = {
      transcriptionProvider: config.transcriptionProvider || process.env.TRANSCRIPTION_PROVIDER || 'deepgram',
      deepgramApiKey: config.deepgramApiKey || process.env.DEEPGRAM_API_KEY,
      isLiveMeeting: config.isLiveMeeting !== undefined ? config.isLiveMeeting : process.env.IS_LIVE_MEETING === 'true',
      audioDeviceIdMic: config.audioDeviceIdMic || process.env.AUDIO_DEVICE_ID_MIC,
      audioDeviceIdSystem: config.audioDeviceIdSystem || process.env.AUDIO_DEVICE_ID_SYSTEM,
      sampleRate: config.sampleRate || 16000,
      confidenceThreshold: config.confidenceThreshold !== undefined ? config.confidenceThreshold : 0.85,
      skipLlm: config.skipLlm !== undefined ? config.skipLlm : process.env.SKIP_LLM === 'true',
    };

    // Validate configuration
    if (this.config.transcriptionProvider.toLowerCase() === 'deepgram' && !this.config.deepgramApiKey) {
      throw new Error('DEEPGRAM_API_KEY must be set in .env (or set TRANSCRIPTION_PROVIDER=local)');
    }

    this._isRunning = false;
    this.deviceManager = null;
    this.transcriptManager = new TranscriptManager();
    this.aiClient = createAIService(this.transcriptManager);
    this.lastSavePrefix = null; // Set when saving outputs
  }

  /**
   * Getter for isRunning property.
   */
  get isRunning() {
    return this._isRunning;
  }

  /**
   * Crea DeviceManager + device, sottoscrive gli eventi, avvia la cattura.
   * @returns {Promise<void>}
   */
  async start() {
    if (this._isRunning) {
      throw new Error('Meeting session is already running');
    }

    this.deviceManager = new DeviceManager();

    // Add Microphone Device
    this.deviceManager.addDevice('mic', {
      deviceId: this.config.audioDeviceIdMic,
      label: this.config.isLiveMeeting ? 'live' : 'user',
      apiKey: this.config.deepgramApiKey,
      sampleRate: this.config.sampleRate
    });

    // Add System Audio Device
    this.deviceManager.addDevice('sys', {
      deviceId: this.config.audioDeviceIdSystem,
      label: 'caller',
      apiKey: this.config.deepgramApiKey,
      sampleRate: this.config.sampleRate
    });

    // Handle Transcription Events
    this.deviceManager.on('transcription', (evt) => {
      this._handleTranscriptionEvent(evt);
    });

    // Handle Device Errors
    this.deviceManager.on('deviceError', (err) => {
      this.emit('error', err);
    });

    // Start all devices
    await this.deviceManager.startAll();
    this._isRunning = true;
    this.emit('status', { state: 'running' });
  }

  /**
   * Internal method to handle transcription events (confidence filtering and re-emission).
   * @private
   */
  _handleTranscriptionEvent(evt) {
    // Filter by confidence threshold
    if (evt.confidence !== undefined && evt.confidence < this.config.confidenceThreshold) {
      return;
    }

    // Determine display source
    const displaySource = determineDisplaySource(this.config.isLiveMeeting, evt.source, evt.speaker);

    // Add to transcript
    this.transcriptManager.addTranscriptEntry(evt.timestamp, displaySource, evt.text, evt.confidence);

    // Re-emit with display source
    this.emit('transcription', {
      source: displaySource,
      text: evt.text,
      confidence: evt.confidence,
      timestamp: evt.timestamp
    });
  }

  /**
   * Query AI on the current transcript.
   * @param {string} text
   * @returns {Promise<string>}
   */
  async query(text) {
    return await this.aiClient.query(text);
  }

  /**
   * Get the complete transcript.
   * @returns {string}
   */
  getTranscript() {
    return this.transcriptManager.getTranscript();
  }

  /**
   * Stop the meeting; optionally save transcript+recap.
   * @param {{save?: boolean}} options
   * @returns {Promise<void>}
   */
  async stop({ save = true } = {}) {
    if (!this._isRunning) {
      return; // Idempotent
    }

    if (this.deviceManager) {
      await this.deviceManager.stopAll();
    }

    if (save) {
      const prefix = (new Date()).toISOString().slice(0, 16).replace(/:/g, '');
      await saveMeetingOutputs(this.transcriptManager, this.aiClient, {
        prefix,
        skipLlm: this.config.skipLlm,
      });
      this.lastSavePrefix = prefix;
    }

    this._isRunning = false;
    this.emit('status', { state: 'stopped' });
  }
}

module.exports = { MeetingSession };
