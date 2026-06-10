import { EventEmitter } from 'events';
import type {
  BatchTranscribeOptions,
  TranscriptionEvent,
  TranscriptionService,
} from './TranscriptionService.ts';
import type { LocalBackend, VadLike } from './local/local-backend.ts';
import { getSharedBackend, PIPELINE_SAMPLE_RATE } from './local/local-backend.ts';
import { SpeakerClusterer } from './local/SpeakerClusterer.ts';
import { int16BufferToFloat32, resampleLinear } from './local/resample.ts';

const VAD_WINDOW_SIZE = 512; // samples @ 16 kHz, required by Silero VAD
// Segments shorter than this produce unreliable speaker embeddings; the
// clusterer falls back to the previous speaker for them.
const MIN_EMBED_DURATION_SEC = 0.5;
// Whisper provides no per-utterance confidence; emit a fixed, documented value.
const FIXED_CONFIDENCE = 0.95;

/**
 * Fully local transcription provider: Silero VAD segments the incoming audio
 * into utterances, Whisper (via sherpa-onnx) transcribes them, and speaker
 * embeddings + online clustering provide diarization. Same contract as
 * DeepgramTranscriptionService; everything runs on-device.
 */
export class LocalTranscriptionService extends EventEmitter implements TranscriptionService {
  private readonly backend: LocalBackend;
  private readonly clusterer = new SpeakerClusterer();
  private vad: VadLike | null = null;
  private connected = false;
  private source: string | null = null;
  private inputSampleRate = PIPELINE_SAMPLE_RATE;
  private pending = new Float32Array(0); // leftover samples < one VAD window
  // Per-instance FIFO so utterances are emitted in the order they were spoken.
  private segmentQueue: Promise<void> = Promise.resolve();
  // When set (batch mode), utterance timestamps are baseTimestamp + in-clip
  // offset (derived from the VAD-reported start sample); otherwise (live
  // streaming) they default to Date.now().
  private baseTimestamp: number | null = null;

  constructor(backend: LocalBackend = getSharedBackend()) {
    super();
    this.backend = backend;
  }

  connect(sampleRate = 16000, source: string | null = null): void {
    this.source = source;
    this.inputSampleRate = sampleRate;
    console.log(`[local-transcription] Connecting (sampleRate: ${sampleRate}, source: ${source})`);

    this.backend
      .init()
      .then(() => {
        this.vad = this.backend.createVad();
        this.pending = new Float32Array(0);
        this.connected = true;
        this.emit('connected');
      })
      .catch((err: Error) => {
        console.error('[local-transcription] Initialization failed:', err.message);
        this.emit('error', err);
        this.emit('disconnected');
      });
  }

  sendAudio(buffer: Buffer): void {
    if (!this.connected || !this.vad) return;

    let samples = int16BufferToFloat32(buffer);
    samples = resampleLinear(samples, this.inputSampleRate, PIPELINE_SAMPLE_RATE);

    // Prepend leftover from the previous call, then feed full VAD windows.
    const merged = new Float32Array(this.pending.length + samples.length);
    merged.set(this.pending);
    merged.set(samples, this.pending.length);

    let offset = 0;
    while (offset + VAD_WINDOW_SIZE <= merged.length) {
      this.vad.acceptWaveform(merged.subarray(offset, offset + VAD_WINDOW_SIZE));
      offset += VAD_WINDOW_SIZE;
    }
    this.pending = merged.slice(offset);

    this.drainSegments();
  }

  disconnect(): void {
    if (this.vad) {
      try {
        this.vad.flush();
        this.drainSegments();
      } catch (e) {
        console.error('[local-transcription] Error flushing VAD:', (e as Error).message);
      }
    }
    const wasConnected = this.connected;
    this.connected = false;
    this.vad = null;
    this.pending = new Float32Array(0);
    this.clusterer.reset();
    if (wasConnected) this.emit('disconnected');
  }

  /**
   * One-shot transcription of a whole pre-recorded clip. Local inference is
   * CPU-bound and offline, so "feed everything, then flush" already is batch
   * processing — no pacing needed. Emits the same 'transcription' events as the
   * streaming path and resolves once every utterance has been processed.
   */
  async transcribeBatch(audio: Buffer, opts: BatchTranscribeOptions = {}): Promise<void> {
    this.source = opts.source ?? null;
    this.inputSampleRate = opts.sampleRate ?? PIPELINE_SAMPLE_RATE;
    this.baseTimestamp = opts.baseTimestamp ?? Date.now();

    await this.backend.init();
    this.vad = this.backend.createVad();
    this.pending = new Float32Array(0);
    this.clusterer.reset();
    this.connected = true;

    // Feed the entire clip through the same windowing as live streaming, then
    // flush so the trailing speech segment is emitted too.
    this.sendAudio(audio);
    this.vad.flush();
    this.drainSegments();

    // Wait for every queued segment to finish transcribing/diarizing.
    await this.segmentQueue;

    this.connected = false;
    this.vad = null;
    this.pending = new Float32Array(0);
    this.baseTimestamp = null;
  }

  private drainSegments(): void {
    if (!this.vad) return;
    while (!this.vad.isEmpty()) {
      const segment = this.vad.front();
      this.vad.pop();
      // `start` is the segment's sample index in the fed stream; capture it
      // before pop() so batch timestamps reflect real in-clip position.
      const startSample = segment.start;
      // Copy: the segment buffer may be reused by the native layer.
      const samples = Float32Array.from(segment.samples);
      this.segmentQueue = this.segmentQueue
        .then(() => this.processSegment(samples, startSample))
        .catch((err: Error) => {
          console.error('[local-transcription] Segment processing error:', err.message);
          this.emit('error', err);
        });
    }
  }

  private async processSegment(samples: Float32Array, startSample: number): Promise<void> {
    const text = await this.backend.transcribe(samples);
    if (!text) return;

    let embedding: Float32Array | null = null;
    if (samples.length >= MIN_EMBED_DURATION_SEC * PIPELINE_SAMPLE_RATE) {
      embedding = await this.backend.embed(samples);
    }
    const speaker = this.clusterer.assign(embedding);

    const timestamp = this.baseTimestamp === null
      ? Date.now()
      : this.baseTimestamp + Math.round((startSample / PIPELINE_SAMPLE_RATE) * 1000);

    const evt: TranscriptionEvent = {
      text,
      speaker,
      confidence: FIXED_CONFIDENCE,
      timestamp,
      source: this.source,
    };
    this.emit('transcription', evt);
  }
}
