const { EventEmitter } = require('events');

class MockAudioIO extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.isActive = false;
    
    // Simulate error if deviceId is -999
    if (options.inOptions.deviceId === -999) {
      throw new Error('Device initialization failed');
    }
  }

  start() {
    this.isActive = true;
    // Simulate streaming data
    this.interval = setInterval(() => {
      if (this.isActive) {
        // Generate mock audio buffer (16-bit PCM)
        const buffer = Buffer.alloc(32000); // ~1 sec at 16kHz 16bit mono
        this.emit('data', buffer);
      }
    }, 100);
  }

  quit() {
    this.isActive = false;
    if (this.interval) {
      clearInterval(this.interval);
    }
  }
}

const devices = [
  { id: 1, name: 'Microphone (Realtek Audio)', maxInputChannels: 2, defaultSampleRate: 48000 },
  { id: 2, name: 'Stereo Mix (Realtek Audio)', maxInputChannels: 2, defaultSampleRate: 44100 },
  { id: 3, name: 'Headset (Bluetooth)', maxInputChannels: 1, defaultSampleRate: 16000 },
  { id: 4, name: 'Output Device', maxInputChannels: 0, defaultSampleRate: 48000 } // Output only
];

module.exports = {
  AudioIO: MockAudioIO,
  getDevices: () => devices,
  SampleFormat16Bit: 1
};
