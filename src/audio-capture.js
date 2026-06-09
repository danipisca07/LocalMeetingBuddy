const portAudio = require('naudiodon');
const { EventEmitter } = require('events');

class AudioCapture extends EventEmitter {
  constructor(options = {}) {
    super();
    this.sampleRate = options.sampleRate || 16000;
    this.deviceId = options.deviceId !== undefined ? parseInt(options.deviceId, 10) : -1;
    this.deviceName = options.deviceName || null;
    this.ai = null;
    this.isRecording = false;
    this.initialized = false;
    this._lastLevelTs = 0;
  }

  getDevices() {
    return portAudio.getDevices();
  }

  initialize() {
    if (this.initialized) return;

    // Try to find a device if no valid deviceId provided
    if (this.deviceId === -1 || isNaN(this.deviceId)) {
      const devices = this.getDevices();
      let selectedDevice = null;

      // 1. Try to find by name if provided
      if (this.deviceName) {
        selectedDevice = devices.find(d => 
          d.maxInputChannels > 0 && 
          d.name.toLowerCase().includes(this.deviceName.toLowerCase())
        );
        if (selectedDevice) {
            console.log(`Found device matching "${this.deviceName}": ${selectedDevice.name} (ID: ${selectedDevice.id})`);
        } else {
            console.warn(`Warning: No device found matching "${this.deviceName}". Falling back to auto-detection.`);
        }
      }

      // 2. Auto-detection if not found by name
      if (!selectedDevice) {
        selectedDevice = devices.find(d => 
            d.maxInputChannels > 0 && 
            (d.name.toLowerCase().includes('loopback') || 
             d.name.toLowerCase().includes('stereo mix') ||
             d.name.toLowerCase().includes('missaggio stereo')) // Add Italian support
        );
      }

      if (selectedDevice) {
        this.deviceId = selectedDevice.id;
        console.log(`Selected audio device: ${selectedDevice.name} (ID: ${selectedDevice.id})`);
      } else {
        // 3. Fallback to default input
        const defaultDevice = devices.find(d => d.maxInputChannels > 0);
        if (defaultDevice) {
            this.deviceId = defaultDevice.id;
            console.log(`No specific device found. Using default input: ${defaultDevice.name} (ID: ${defaultDevice.id})`);
        } else {
            throw new Error('No input audio devices found.');
        }
      }
    } else {
        console.log(`Using explicitly configured Device ID: ${this.deviceId}`);
    }

    // Update sample rate to match device default to avoid "Format not supported" errors
    // specially important for Windows WASAPI/Loopback devices
    const devices = this.getDevices();
    const currentDevice = devices.find(d => d.id === this.deviceId);
    if (currentDevice && currentDevice.defaultSampleRate) {
        console.log(`Updating sample rate from ${this.sampleRate}Hz to device default ${currentDevice.defaultSampleRate}Hz`);
        this.sampleRate = currentDevice.defaultSampleRate;
    }

    this.initialized = true;
  }

  start() {
    if (this.isRecording) return;
    
    if (!this.initialized) {
        this.initialize();
    }

    console.log(`Starting audio capture with Device ID: ${this.deviceId}, Sample Rate: ${this.sampleRate}Hz`);

    try {
      this.ai = new portAudio.AudioIO({
        inOptions: {
          channelCount: 1,
          sampleFormat: portAudio.SampleFormat16Bit,
          sampleRate: this.sampleRate,
          deviceId: this.deviceId,
          closeOnError: true
        }
      });
    } catch (e) {
      const devices = this.getDevices();
      const fallback = devices.find(d => d.maxInputChannels > 0);
      if (fallback && fallback.id !== this.deviceId) {
        this.deviceId = fallback.id;
        this.ai = new portAudio.AudioIO({
          inOptions: {
            channelCount: 1,
            sampleFormat: portAudio.SampleFormat16Bit,
            sampleRate: this.sampleRate,
            deviceId: this.deviceId,
            closeOnError: true
          }
        });
      } else {
        throw e;
      }
    }

    this.ai.on('data', (data) => {
      this.emit('audio', data);
      const now = Date.now();
      if (now - this._lastLevelTs > 200) {
        let sum = 0;
        for (let i = 0; i < data.length; i += 2) {
          const sample = data.readInt16LE(i);
          sum += sample * sample;
        }
        const rms = Math.sqrt(sum / (data.length / 2));
        const db = 20 * Math.log10(rms / 32768 + 1e-9);
        this.emit('level', { db });
        this._lastLevelTs = now;
      }
    });

    this.ai.on('error', (err) => {
      console.error('Audio capture error:', err);
      this.emit('error', err);
    });

    this.ai.start();
    this.isRecording = true;
    console.log('Audio capture started.');
  }

  stop() {
    if (!this.isRecording || !this.ai) return;
    this.ai.quit();
    this.isRecording = false;
    this.ai = null;
    console.log('Audio capture stopped.');
  }
}

module.exports = AudioCapture;
