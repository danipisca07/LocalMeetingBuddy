import { EventEmitter } from 'events';
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import type {
  BatchTranscribeOptions,
  TranscriptionEvent,
  TranscriptionService,
} from './TranscriptionService.ts';
import { pcmToWav } from './wav.ts';

type LiveConnection = ReturnType<ReturnType<typeof createClient>['listen']['live']>;

interface DeepgramWord {
  speaker: number;
  word: string;
}

interface SpeakerPhrase {
  speaker: number;
  words: string[];
}

/** Deepgram-backed live transcription provider. */
export class DeepgramTranscriptionService extends EventEmitter implements TranscriptionService {
  private readonly client: ReturnType<typeof createClient>;
  private connection: LiveConnection | null = null;
  private keepAliveInterval: ReturnType<typeof setInterval> | null = null;
  private source: string | null = null;

  constructor(apiKey: string) {
    super();
    if (!apiKey) throw new Error('Deepgram API key is required');
    this.client = createClient(apiKey);
  }

  connect(sampleRate = 16000, source: string | null = null): void {
    const language = process.env.DEEPGRAM_LANGUAGE || 'it';
    console.log(`Connecting to Deepgram with language: ${language}`);
    this.source = source;

    this.connection = this.client.listen.live({
      model: 'nova-2',
      language,
      smart_format: true,
      encoding: 'linear16',
      channels: 1,
      sample_rate: sampleRate,
      interim_results: true,
      utterance_end_ms: 1000,
      vad_events: true,
      diarize: true,
    });

    this.connection.on(LiveTranscriptionEvents.Open, () => {
      console.log('Deepgram connection opened.');
      this.emit('connected');
      this.keepAliveInterval = setInterval(() => {
        if (this.connection && this.connection.getReadyState() === 1) {
          this.connection.keepAlive();
        }
      }, 10000);
    });

    this.connection.on(LiveTranscriptionEvents.Close, () => {
      console.log('Deepgram connection closed.');
      this.emit('disconnected');
      if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
    });

    // `data` is typed loosely at the SDK boundary, then narrowed into typed locals.
    this.connection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
      const alternative = data.channel.alternatives[0];
      const transcript: string = alternative.transcript;
      const confidence: number = alternative.confidence;

      if (transcript && data.is_final) {
        const list: DeepgramWord[] = alternative.words.map((w: DeepgramWord) => ({
          speaker: w.speaker,
          word: w.word,
        }));

        // Join consecutive words spoken by the same speaker into phrases.
        const phrases = list.reduce<SpeakerPhrase[]>((acc, cur) => {
          const last = acc[acc.length - 1];
          if (!last || last.speaker !== cur.speaker) {
            acc.push({ speaker: cur.speaker, words: [cur.word] });
          } else {
            last.words.push(cur.word);
          }
          return acc;
        }, []);

        const ts = Date.now();
        phrases.forEach((phrase) => {
          const evt: TranscriptionEvent = {
            text: phrase.words.join(' '),
            speaker: phrase.speaker,
            confidence,
            timestamp: ts,
            source: this.source,
          };
          this.emit('transcription', evt);
        });
      }
    });

    this.connection.on(LiveTranscriptionEvents.Error, (err: Error) => {
      console.error('Deepgram error:', err);
      this.emit('error', err);
    });
  }

  sendAudio(buffer: Buffer): void {
    if (this.connection && this.connection.getReadyState() === 1) {
      // Deepgram's typings only list ArrayBuffer/Blob/string, but the underlying
      // ws connection accepts Node Buffers at runtime.
      this.connection.send(buffer as unknown as ArrayBuffer);
    }
  }

  disconnect(): void {
    if (this.connection) {
      this.connection.finish();
      this.connection = null;
    }
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }

  /**
   * One-shot batch transcription via Deepgram's pre-recorded REST API
   */
  async transcribeBatch(audio: Buffer, opts: BatchTranscribeOptions = {}): Promise<void> {
    const sampleRate = opts.sampleRate ?? 16000;
    const source = opts.source ?? null;
    const base = opts.baseTimestamp ?? Date.now();
    const language = process.env.DEEPGRAM_LANGUAGE || 'it';

    const wav = pcmToWav(audio, sampleRate, 1);

    const { result, error } = await this.client.listen.prerecorded.transcribeFile(wav, {
      model: 'nova-2',
      language,
      smart_format: true,
      punctuate: true,
      diarize: true,
    });

    if (error) throw error;

    const alternative = result?.results?.channels?.[0]?.alternatives?.[0];
    if (!alternative || !alternative.transcript) return;

    const confidence = alternative.confidence;
    const words = alternative.words || [];

    interface BatchPhrase {
      speaker?: number;
      words: string[];
      start: number;
    }

    // Join consecutive words from the same speaker into phrases,
    // keeping each phrase's start time for the timestamp.
    const phrases = words.reduce<BatchPhrase[]>((acc, cur) => {
      const last = acc[acc.length - 1];
      const text = cur.punctuated_word || cur.word;
      if (!last || last.speaker !== cur.speaker) {
        acc.push({ speaker: cur.speaker, words: [text], start: cur.start });
      } else {
        last.words.push(text);
      }
      return acc;
    }, []);

    phrases.forEach((phrase) => {
      const evt: TranscriptionEvent = {
        text: phrase.words.join(' '),
        speaker: phrase.speaker,
        confidence,
        timestamp: base + Math.round(phrase.start * 1000),
        source,
      };
      this.emit('transcription', evt);
    });
  }
}
