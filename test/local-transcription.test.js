const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

const { LocalTranscriptionService } = require('../src/transcription/LocalTranscriptionService.ts');
const { MockLocalBackend } = require('./mocks/local-backend.mock');
const { int16BufferToFloat32, resampleLinear } = require('../src/transcription/local/resample.ts');

const SEGMENT_SAMPLES = 16000; // 1s @ 16 kHz, long enough for speaker embedding

function onceEvent(emitter, event) {
  return new Promise((resolve) => emitter.once(event, resolve));
}

function connectService(service) {
  const connected = onceEvent(service, 'connected');
  service.connect(16000, 'test-source');
  return connected;
}

/** Queues a VAD speech segment and triggers processing via a sendAudio call. */
function emitSegment(service, backend, samples = new Float32Array(SEGMENT_SAMPLES)) {
  backend.lastVad.queueSegment(samples);
  service.sendAudio(Buffer.alloc(2048)); // any audio triggers drainSegments
}

describe('resample utilities', () => {
  it('converts int16 PCM buffers to normalized floats', () => {
    const buf = Buffer.alloc(6);
    buf.writeInt16LE(0, 0);
    buf.writeInt16LE(16384, 2);
    buf.writeInt16LE(-32768, 4);
    const out = int16BufferToFloat32(buf);
    assert.deepStrictEqual(Array.from(out), [0, 0.5, -1]);
  });

  it('returns input unchanged when rates match', () => {
    const samples = Float32Array.from([0.1, 0.2]);
    assert.strictEqual(resampleLinear(samples, 16000, 16000), samples);
  });

  it('halves the sample count when downsampling 32k -> 16k', () => {
    const out = resampleLinear(new Float32Array(3200), 32000, 16000);
    assert.strictEqual(out.length, 1600);
  });

  it('interpolates values when downsampling', () => {
    const out = resampleLinear(Float32Array.from([0, 1, 0, 1]), 32000, 16000);
    assert.strictEqual(out[0], 0);
    assert.strictEqual(out[1], 0);
  });
});

describe('LocalTranscriptionService', () => {
  let backend;
  let service;

  beforeEach(() => {
    backend = new MockLocalBackend();
    service = new LocalTranscriptionService(backend);
  });

  it('emits "connected" after backend init', async () => {
    await connectService(service);
    assert.strictEqual(backend.initCalls, 1);
    assert.ok(backend.lastVad);
  });

  it('emits "error" and "disconnected" when init fails', async () => {
    backend.failInit = true;
    const error = onceEvent(service, 'error');
    const disconnected = onceEvent(service, 'disconnected');
    service.connect(16000, 'x');
    assert.match((await error).message, /mock init failure/);
    await disconnected;
  });

  it('ignores sendAudio before connect', () => {
    service.sendAudio(Buffer.alloc(3200)); // must not throw
    assert.strictEqual(backend.transcribeCalls.length, 0);
  });

  it('feeds full 512-sample windows to the VAD and keeps the remainder', async () => {
    await connectService(service);
    service.sendAudio(Buffer.alloc(1200 * 2)); // 1200 samples -> 2 windows + 176 leftover
    assert.strictEqual(backend.lastVad.windows, 2);
    assert.strictEqual(backend.lastVad.receivedSamples, 1024);
    service.sendAudio(Buffer.alloc(400 * 2)); // leftover 176 + 400 = 576 -> 1 more window
    assert.strictEqual(backend.lastVad.windows, 3);
  });

  it('resamples non-16k input before feeding the VAD', async () => {
    const connected = onceEvent(service, 'connected');
    service.connect(48000, 'mic');
    await connected;
    service.sendAudio(Buffer.alloc(4800 * 2)); // 100ms @ 48k -> 1600 samples @ 16k
    assert.strictEqual(backend.lastVad.receivedSamples, 1536); // 3 full windows
  });

  it('emits a transcription event with the Deepgram-compatible shape', async () => {
    await connectService(service);
    backend.transcribeResults.push('ciao a tutti');
    const evtPromise = onceEvent(service, 'transcription');
    emitSegment(service, backend);
    const evt = await evtPromise;
    assert.strictEqual(evt.text, 'ciao a tutti');
    assert.strictEqual(typeof evt.speaker, 'number');
    assert.strictEqual(typeof evt.confidence, 'number');
    assert.ok(evt.confidence > 0 && evt.confidence <= 1);
    assert.strictEqual(typeof evt.timestamp, 'number');
    assert.strictEqual(evt.source, 'test-source');
  });

  it('does not emit for empty transcriptions', async () => {
    await connectService(service);
    backend.transcribeResults.push('', 'parlato');
    let events = 0;
    service.on('transcription', () => events++);
    emitSegment(service, backend);
    emitSegment(service, backend);
    await onceEvent(service, 'transcription');
    assert.strictEqual(events, 1);
  });

  it('assigns different speakers to dissimilar voices', async () => {
    await connectService(service);
    backend.transcribeResults.push('voce uno', 'voce due', 'ancora uno');
    backend.embedResults.push(
      Float32Array.from([1, 0, 0]),
      Float32Array.from([0, 1, 0]),
      Float32Array.from([0.95, 0.05, 0])
    );
    const events = [];
    service.on('transcription', (evt) => events.push(evt));
    emitSegment(service, backend);
    emitSegment(service, backend);
    emitSegment(service, backend);
    while (events.length < 3) await onceEvent(service, 'transcription');
    assert.strictEqual(events[0].speaker, 0);
    assert.strictEqual(events[1].speaker, 1);
    assert.strictEqual(events[2].speaker, 0);
  });

  it('skips embedding for segments shorter than 0.5s and reuses the last speaker', async () => {
    await connectService(service);
    const evtPromise = onceEvent(service, 'transcription');
    emitSegment(service, backend, new Float32Array(4000)); // 0.25s
    const evt = await evtPromise;
    assert.strictEqual(backend.embedCalls.length, 0);
    assert.strictEqual(evt.speaker, 0);
  });

  it('emits "disconnected" on disconnect and flushes the VAD', async () => {
    await connectService(service);
    const vad = backend.lastVad;
    const disconnected = onceEvent(service, 'disconnected');
    service.disconnect();
    await disconnected;
    assert.strictEqual(vad.flushed, true);
  });

  it('does not emit "disconnected" when never connected', () => {
    let emitted = false;
    service.on('disconnected', () => { emitted = true; });
    service.disconnect();
    assert.strictEqual(emitted, false);
  });

  it('transcribeBatch emits utterances with base + in-clip offset timestamps', async () => {
    // Seed the VAD (created inside transcribeBatch) with a segment 1s into the clip.
    const origCreateVad = backend.createVad.bind(backend);
    backend.createVad = () => {
      const vad = origCreateVad();
      vad.segments.push({ start: 16000, samples: new Float32Array(SEGMENT_SAMPLES) }); // 1.0s offset
      return vad;
    };
    backend.transcribeResults.push('ciao a tutti');

    const events = [];
    service.on('transcription', (e) => events.push(e));
    await service.transcribeBatch(Buffer.alloc(2048), { source: 'track0', baseTimestamp: 1000 });

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].text, 'ciao a tutti');
    assert.strictEqual(events[0].source, 'track0');
    assert.strictEqual(events[0].speaker, 0);
    assert.strictEqual(events[0].timestamp, 2000); // 1000 base + 1000ms offset
  });
});
