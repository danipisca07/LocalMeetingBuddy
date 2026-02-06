const EventEmitter = require('events');
const AudioCapture = require('./audio-capture');
const TranscriptionService = require('./transcription');

class MeetingDevice extends EventEmitter {
  constructor(config) {
    super();
    this.config = config; // { deviceId, label, apiKey, sampleRate }
    this.capture = null;
    this.transcription = null;
    this.reconnectTimer = null;
    this.retryCount = 0;
    this.isExpectedToRun = false;
    this.maxRetries = 10;
    this.baseRetryDelay = 1000;
    this.maxRetryDelay = 30000;
    this.transcriptionConnected = false;
    this.captureInitialized = false;
  }

  initialize() {
    if (!this.config.deviceId || this.config.deviceId === '') {
      console.warn(`[${this.config.label}] No device ID configured. Skipping initialization.`);
      return false;
    }
    
    // Create instances
    this.capture = new AudioCapture({
      sampleRate: this.config.sampleRate,
      deviceId: this.config.deviceId
    });

    this.transcription = new TranscriptionService(this.config.apiKey);
    
    this._setupEventHandlers();
    return true;
  }

  _setupEventHandlers() {
    // Transcription events
    this.transcription.on('transcription', (evt) => {
      this.emit('transcription', { ...evt, source: this.config.label });
    });

    this.transcription.on('connected', () => {
      console.log(`[${this.config.label}] Transcription connected.`);
      this.transcriptionConnected = true;
      this.retryCount = 0; // Reset retry count on successful connection
      
      // Start capturing audio if we are expected to run
      if (this.isExpectedToRun && this.capture) {
        try {
            this.capture.start();
        } catch (err) {
            console.error(`[${this.config.label}] Failed to start capture after connection: ${err.message}`);
            this._handleDisconnect();
        }
      }
      this.emit('connected');
    });

    this.transcription.on('disconnected', () => {
      console.log(`[${this.config.label}] Transcription disconnected.`);
      this.transcriptionConnected = false;
      this._handleDisconnect();
    });

    this.transcription.on('error', (err) => {
      console.error(`[${this.config.label}] Transcription error:`, err.message);
      this.emit('error', err);
      // Depending on the error, we might need to reconnect. 
      // For now, assume critical errors lead to disconnect or we rely on the disconnect event.
    });

    // Capture events
    this.capture.on('audio', (data) => {
      if (this.transcriptionConnected && this.transcription) {
        this.transcription.sendAudio(data);
      }
    });

    this.capture.on('error', (err) => {
      console.error(`[${this.config.label}] Audio capture error:`, err.message);
      this.emit('error', err);
      // If audio capture fails, we should probably restart the whole chain
      this._handleDisconnect();
    });
  }

  start() {
    this.isExpectedToRun = true;
    this._connect();
  }

  stop() {
    this.isExpectedToRun = false;
    this._cleanup();
    console.log(`[${this.config.label}] Stopped.`);
  }

  _connect() {
    if (!this.capture || !this.transcription) {
        if (!this.initialize()) return;
    }

    try {
      // We start by connecting transcription service. 
      // Once connected, it triggers capture.start() in the 'connected' handler.
      // We also initialize capture here to ensure sample rates are updated if needed.
      if (!this.captureInitialized) {
          this.capture.initialize();
          this.captureInitialized = true;
      }
      
      this.transcription.connect(this.capture.sampleRate, this.config.label);
    } catch (err) {
      console.error(`[${this.config.label}] Connection failed: ${err.message}`);
      this._handleDisconnect();
    }
  }

  _cleanup() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.capture) {
      try {
        this.capture.stop();
      } catch (e) { console.error(`[${this.config.label}] Error stopping capture:`, e.message); }
    }

    if (this.transcription) {
      try {
        this.transcription.disconnect();
      } catch (e) { console.error(`[${this.config.label}] Error disconnecting transcription:`, e.message); }
    }
    
    this.transcriptionConnected = false;
  }

  _handleDisconnect() {
    if (!this.isExpectedToRun) return;

    // Avoid multiple reconnect schedules
    if (this.reconnectTimer) return;

    this._cleanup();
    this.emit('disconnected');

    const delay = Math.min(
      this.baseRetryDelay * Math.pow(2, this.retryCount),
      this.maxRetryDelay
    );

    console.log(`[${this.config.label}] Connection lost. Reconnecting in ${delay}ms... (Attempt ${this.retryCount + 1})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.retryCount++;
      this._connect();
    }, delay);
  }
}

class DeviceManager extends EventEmitter {
  constructor() {
    super();
    this.devices = new Map();
  }

  addDevice(id, config) {
    const device = new MeetingDevice(config);
    
    device.on('transcription', (evt) => this.emit('transcription', evt));
    device.on('connected', () => this.emit('deviceConnected', id));
    device.on('disconnected', () => this.emit('deviceDisconnected', id));
    device.on('error', (err) => this.emit('deviceError', { id, error: err }));

    this.devices.set(id, device);
    return device;
  }

  getDevice(id) {
    return this.devices.get(id);
  }

  async startAll() {
    console.log('Starting all devices...');
    let startedCount = 0;
    for (const [id, device] of this.devices) {
      // Check if device is valid before starting
      if (device.config.deviceId && device.config.deviceId.trim() !== '' && !isNaN(Number(device.config.deviceId))) {
          device.start();
          startedCount++;
      } else {
          console.log(`[DeviceManager] Skipping invalid device configuration for ${id}`);
      }
    }
    if (startedCount === 0) {
        console.warn('[DeviceManager] No valid devices were started.');
    }
  }

  stopAll() {
    console.log('Stopping all devices...');
    for (const device of this.devices.values()) {
      device.stop();
    }
  }
}

module.exports = { DeviceManager, MeetingDevice };
