const { test, describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');

// Mock require to inject our mocked naudiodon
const originalRequire = require('module').prototype.require;
const naudiodonMock = require('./mocks/naudiodon.mock');

// Helper to load module with mocks
function requireWithMocks(modulePath, mocks) {
  const cacheKey = require.resolve(modulePath);
  delete require.cache[cacheKey];
  
  // Intercept require calls inside the module
  const originalLoader = require.extensions['.js'];
  
  require.extensions['.js'] = function(module, filename) {
    const originalRequire = module.require;
    module.require = function(path) {
      if (mocks[path]) {
        return mocks[path];
      }
      return originalRequire.call(this, path);
    };
    originalLoader(module, filename);
  };

  try {
    return require(modulePath);
  } finally {
    // Restore original loader
    require.extensions['.js'] = originalLoader;
  }
}

// Since require.extensions is deprecated and tricky, let's use a simpler approach:
// We'll rely on 'proxyquire' style by manually manipulating cache if possible,
// or just using the fact that 'naudiodon' is a top-level module.
// The easiest way without libraries in Node is to mock 'naudiodon' in require.cache
// BEFORE requiring the module under test.

const naudiodonPath = require.resolve('naudiodon');
require.cache[naudiodonPath] = {
  id: naudiodonPath,
  filename: naudiodonPath,
  loaded: true,
  exports: naudiodonMock
};

// Now we can require AudioCapture normally
const AudioCapture = require('../audio-capture');

describe('AudioCapture Component', () => {
  let audioCapture;

  afterEach(() => {
    if (audioCapture) {
      audioCapture.stop();
      audioCapture = null;
    }
  });

  it('should initialize with default sample rate', () => {
    audioCapture = new AudioCapture();
    assert.strictEqual(audioCapture.sampleRate, 16000);
    assert.strictEqual(audioCapture.deviceId, -1);
  });

  it('should auto-detect device by name', () => {
    audioCapture = new AudioCapture({ deviceName: 'Stereo Mix' });
    audioCapture.initialize();
    
    // In mock, Stereo Mix is ID 2
    assert.strictEqual(audioCapture.deviceId, 2);
    // Should update sample rate to device default (44100)
    assert.strictEqual(audioCapture.sampleRate, 44100);
  });

  it('should fallback to default input if specific device not found', () => {
    audioCapture = new AudioCapture({ deviceName: 'NonExistentDevice' });
    audioCapture.initialize();
    
    // Logic prefers Stereo Mix/Loopback (ID 2 in mock) over generic default
    assert.strictEqual(audioCapture.deviceId, 2);
  });

  it('should recover if device init fails (simulated bad ID)', () => {
    // ID -999 triggers error in our mock
    // But start() catches it and falls back
    audioCapture = new AudioCapture({ deviceId: -999 });
    
    // Should NOT throw, but recover
    assert.doesNotThrow(() => {
      audioCapture.start();
    });
    
    assert.strictEqual(audioCapture.isRecording, true);
    assert.notStrictEqual(audioCapture.deviceId, -999);
  });

  it('should start and stop recording correctly', (t, done) => {
    audioCapture = new AudioCapture({ deviceId: 1 });
    
    let audioDataReceived = false;
    audioCapture.on('audio', (data) => {
      audioDataReceived = true;
      assert.ok(data.length > 0);
      audioCapture.stop();
    });

    audioCapture.start();
    assert.strictEqual(audioCapture.isRecording, true);

    // Wait a bit for audio
    setTimeout(() => {
      assert.ok(audioDataReceived, 'Should have received audio data');
      assert.strictEqual(audioCapture.isRecording, false);
      done();
    }, 200);
  });

  it('should handle fallback when start fails', () => {
     // This test requires modifying the mock to fail ONLY on start for a specific ID,
     // but our mock constructor throws immediately.
     // AudioCapture.start() wraps constructor in try/catch and attempts fallback.
     
     // Let's manually set deviceId to -999 (which fails in mock constructor)
     // BUT AudioCapture.start() will try to find a fallback.
     audioCapture = new AudioCapture({ deviceId: -999 });
     
     // Initialize explicitly to set the bad ID
     audioCapture.initialize();
     assert.strictEqual(audioCapture.deviceId, -999);
     
     // Start should catch error and switch to fallback (ID 1)
     audioCapture.start();
     
     assert.strictEqual(audioCapture.deviceId, 1, 'Should have fallen back to device ID 1');
     assert.strictEqual(audioCapture.isRecording, true);
  });

  it('should emit level events', (t, done) => {
    audioCapture = new AudioCapture({ deviceId: 1 });
    
    audioCapture.on('level', (level) => {
      assert.ok(typeof level.db === 'number');
      audioCapture.stop();
      done();
    });

    audioCapture.start();
  });
});
