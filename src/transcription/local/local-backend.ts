import { createRequire } from 'module';
import { ensureModels } from './model-manager.ts';

// This file is ESM (type-stripped TS); createRequire lets us load the
// CommonJS native addon lazily.
const requireCjs = createRequire(import.meta.url);

/** Minimal surface of sherpa-onnx's Vad used by the service (mockable in tests). */
export interface VadLike {
  acceptWaveform(samples: Float32Array): void;
  isEmpty(): boolean;
  front(): { start: number; samples: Float32Array };
  pop(): void;
  flush(): void;
}

/**
 * Inference backend used by LocalTranscriptionService. The real implementation
 * wraps sherpa-onnx; tests inject a mock. All audio is 16 kHz mono Float32 in [-1, 1].
 */
export interface LocalBackend {
  init(): Promise<void>;
  createVad(): VadLike;
  transcribe(samples: Float32Array): Promise<string>;
  embed(samples: Float32Array): Promise<Float32Array>;
}

/** Sample rate every model in the local pipeline operates at. */
export const PIPELINE_SAMPLE_RATE = 16000;

class SherpaLocalBackend implements LocalBackend {
  private sherpa: any = null;
  private recognizer: any = null;
  private extractor: any = null;
  private vadModelPath = '';
  private initPromise: Promise<void> | null = null;
  // FIFO queue: inference jobs from all service instances run one at a time
  // so two concurrent streams don't saturate the CPU.
  private queue: Promise<unknown> = Promise.resolve();

  init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.doInit().catch((err) => {
        this.initPromise = null; // allow retry on next connect()
        throw err;
      });
    }
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    // Lazy require so the app never loads the native addon unless the
    // local provider is actually used.
    this.sherpa = requireCjs('sherpa-onnx-node');
    const models = await ensureModels();
    this.vadModelPath = models.sileroVad;

    const language = process.env.LOCAL_TRANSCRIPTION_LANGUAGE
      || process.env.DEEPGRAM_LANGUAGE
      || 'it';
    console.log(`[local-transcription] Loading whisper model (language: ${language})...`);

    this.recognizer = await this.sherpa.OfflineRecognizer.createAsync({
      featConfig: { sampleRate: PIPELINE_SAMPLE_RATE, featureDim: 80 },
      modelConfig: {
        whisper: {
          encoder: models.whisperEncoder,
          decoder: models.whisperDecoder,
          language,
          task: 'transcribe',
        },
        tokens: models.whisperTokens,
        numThreads: 2,
        provider: 'cpu',
        debug: 0,
      },
    });

    this.extractor = new this.sherpa.SpeakerEmbeddingExtractor({
      model: models.speakerEmbedding,
      numThreads: 1,
      provider: 'cpu',
      debug: 0,
    });
    console.log('[local-transcription] Models loaded.');
  }

  createVad(): VadLike {
    if (!this.sherpa) throw new Error('Local backend not initialized');
    return new this.sherpa.Vad(
      {
        sileroVad: {
          model: this.vadModelPath,
          threshold: Number(process.env.LOCAL_VAD_THRESHOLD || 0.5),
          // Mirrors Deepgram's utterance_end_ms: 1000.
          minSilenceDuration: 1.0,
          minSpeechDuration: 0.25,
          maxSpeechDuration: 28,
          windowSize: 512,
        },
        sampleRate: PIPELINE_SAMPLE_RATE,
        numThreads: 1,
        provider: 'cpu',
        debug: 0,
      },
      60 /* bufferSizeInSeconds */
    );
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const next = this.queue.then(job, job);
    this.queue = next.catch(() => {});
    return next;
  }

  transcribe(samples: Float32Array): Promise<string> {
    return this.enqueue(async () => {
      const stream = this.recognizer.createStream();
      stream.acceptWaveform({ samples, sampleRate: PIPELINE_SAMPLE_RATE });
      const result = await this.recognizer.decodeAsync(stream);
      return (result.text || '').trim();
    });
  }

  embed(samples: Float32Array): Promise<Float32Array> {
    return this.enqueue(async () => {
      const stream = this.extractor.createStream();
      stream.acceptWaveform({ samples, sampleRate: PIPELINE_SAMPLE_RATE });
      stream.inputFinished();
      return this.extractor.compute(stream) as Float32Array;
    });
  }
}

let sharedBackend: SherpaLocalBackend | null = null;

/** Module-level singleton: both devices (mic + system) share one set of loaded models. */
export function getSharedBackend(): LocalBackend {
  if (!sharedBackend) sharedBackend = new SherpaLocalBackend();
  return sharedBackend;
}
