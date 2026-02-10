const { test, describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');

// Mocks
const MockAudioCapture = require('./mocks/naudiodon.mock').AudioIO; // We actually need to mock the AudioCapture class itself
const MockTranscriptionService = require('./mocks/transcription.mock');

// We need to intercept require calls for device-manager to use our mocks
// Since AudioCapture is a class export, we need a mock class for it.

class AudioCaptureMock extends require('events').EventEmitter {
  constructor(options) {
    super();
    this.sampleRate = options.sampleRate || 16000;
    this.deviceId = options.deviceId;
    this.isRecording = false;
  }
  initialize() {
      if (this.deviceId === 'INVALID') throw new Error('Invalid Device');
  }
  start() {
    this.isRecording = true;
    this.emit('start');
  }
  stop() {
    this.isRecording = false;
    this.emit('stop');
  }
}

// Manually mock the require cache for AudioCapture and TranscriptionService
const audioCapturePath = require.resolve('../audio-capture');
const transcriptionPath = require.resolve('../transcription');

const originalAudioCapture = require.cache[audioCapturePath];
const originalTranscription = require.cache[transcriptionPath];

require.cache[audioCapturePath] = {
  id: audioCapturePath,
  filename: audioCapturePath,
  loaded: true,
  exports: AudioCaptureMock
};

require.cache[transcriptionPath] = {
  id: transcriptionPath,
  filename: transcriptionPath,
  loaded: true,
  exports: MockTranscriptionService
};

// Now load DeviceManager
const { DeviceManager, MeetingDevice } = require('../device-manager');

describe('DeviceManager Component', () => {
  let deviceManager;

  beforeEach(() => {
    deviceManager = new DeviceManager();
  });

  afterEach(() => {
    deviceManager.stopAll();
  });

  it('should add devices correctly', () => {
    const device = deviceManager.addDevice('mic', {
      deviceId: '1',
      label: 'user',
      apiKey: 'test-key',
      sampleRate: 16000
    });

    assert.ok(device instanceof MeetingDevice);
    assert.strictEqual(deviceManager.getDevice('mic'), device);
  });

  it('should not start invalid devices', async () => {
    // deviceId null
    deviceManager.addDevice('invalid1', { deviceId: null, label: 'test' });
    // deviceId empty
    deviceManager.addDevice('invalid2', { deviceId: '', label: 'test' });
    // deviceId non-number string (assuming logic checks number)
    // The code checks !isNaN(Number(id)), so 'abc' is invalid.
    deviceManager.addDevice('invalid3', { deviceId: 'abc', label: 'test' });

    await deviceManager.startAll();
    
    const d1 = deviceManager.getDevice('invalid1');
    assert.strictEqual(d1.capture, null); // initialize returns false
  });

  it('should initialize and start valid devices', async () => {
    const device = deviceManager.addDevice('mic', {
      deviceId: '1',
      label: 'user',
      apiKey: 'test-key',
      sampleRate: 16000
    });

    await deviceManager.startAll();
    
    assert.ok(device.capture instanceof AudioCaptureMock);
    assert.ok(device.transcription instanceof MockTranscriptionService);
    // Note: capture.start() is called ONLY after transcription connects.
    // Our MockTranscriptionService connects immediately on nextTick.
    
    // We need to wait for the async connection
    await new Promise(resolve => setTimeout(resolve, 50));
    
    assert.strictEqual(device.transcriptionConnected, true);
    assert.strictEqual(device.capture.isRecording, true);
  });

  it('should handle transcription events', (t, done) => {
    const device = deviceManager.addDevice('mic', {
      deviceId: '1',
      label: 'user',
      apiKey: 'test-key'
    });

    deviceManager.on('transcription', (evt) => {
      assert.strictEqual(evt.text, 'Hello world');
      assert.strictEqual(evt.source, 'user'); // Should be overridden by label
      done();
    });

    device.initialize();
    // Simulate event from transcription service
    device.transcription.emit('transcription', { text: 'Hello world', confidence: 0.9 });
  });

  it('should handle reconnection on disconnect', async () => {
    const device = deviceManager.addDevice('mic', {
      deviceId: '1',
      label: 'user',
      apiKey: 'test-key'
    });
    
    // Override retry delay for test speed
    device.baseRetryDelay = 10; 
    
    device.start();
    
    // Wait for connect
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.strictEqual(device.transcriptionConnected, true);

    // Simulate disconnect
    device.transcription.emit('disconnected');
    assert.strictEqual(device.transcriptionConnected, false);
    
    // Should be scheduling reconnect...
    assert.ok(device.reconnectTimer !== null, 'Reconnect timer should be set');
    
    // Wait for reconnect
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Should be connected again (retry logic calls _connect)
    // Our mock connects immediately, so:
    assert.strictEqual(device.transcriptionConnected, true);
  });

  it('should cleanup resources on stop', async () => {
    const device = deviceManager.addDevice('mic', {
      deviceId: '1',
      label: 'user',
      apiKey: 'test-key'
    });

    device.start();
    await new Promise(resolve => setTimeout(resolve, 50));
    
    assert.strictEqual(device.capture.isRecording, true);
    
    device.stop();
    
    assert.strictEqual(device.capture.isRecording, false);
    assert.strictEqual(device.transcriptionConnected, false);
    assert.strictEqual(device.isExpectedToRun, false);
  });
});
