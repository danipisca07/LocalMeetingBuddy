const { EventEmitter } = require('events');

/**
 * Mock of the sherpa-onnx Vad used by LocalTranscriptionService.
 * Tests queue speech segments explicitly via queueSegment(); acceptWaveform
 * just records how many samples the service fed in (to assert resampling).
 */
class MockVad {
  constructor() {
    this.receivedSamples = 0;
    this.windows = 0;
    this.segments = [];
    this.flushed = false;
  }

  acceptWaveform(samples) {
    this.receivedSamples += samples.length;
    this.windows++;
  }

  queueSegment(samples) {
    this.segments.push({ start: 0, samples });
  }

  isEmpty() {
    return this.segments.length === 0;
  }

  front() {
    return this.segments[0];
  }

  pop() {
    this.segments.shift();
  }

  flush() {
    this.flushed = true;
  }
}

/**
 * Mock LocalBackend: transcribe/embed return values from configurable queues.
 * `transcribeResults` and `embedResults` are consumed FIFO; when empty,
 * defaults are returned ('mock text' / a constant embedding).
 */
class MockLocalBackend {
  constructor() {
    this.initCalls = 0;
    this.failInit = false;
    this.lastVad = null;
    this.transcribeResults = [];
    this.embedResults = [];
    this.transcribeCalls = [];
    this.embedCalls = [];
  }

  async init() {
    this.initCalls++;
    if (this.failInit) throw new Error('mock init failure');
  }

  createVad() {
    this.lastVad = new MockVad();
    return this.lastVad;
  }

  async transcribe(samples) {
    this.transcribeCalls.push(samples);
    return this.transcribeResults.length > 0 ? this.transcribeResults.shift() : 'mock text';
  }

  async embed(samples) {
    this.embedCalls.push(samples);
    return this.embedResults.length > 0
      ? this.embedResults.shift()
      : Float32Array.from([1, 0, 0]);
  }
}

module.exports = { MockLocalBackend, MockVad };
