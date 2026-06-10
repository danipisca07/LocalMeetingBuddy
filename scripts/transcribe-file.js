#!/usr/bin/env node
/**
 * Transcribe a pre-recorded audio/video file with the same pipeline as the live
 * app (index.js), but driven by a file instead of a live audio device.
 *
 * Usage:
 *   node scripts/transcribe-file.js <input-file> [options]
 *
 * Options:
 *   --provider <local|deepgram>  Override TRANSCRIPTION_PROVIDER for this run.
 *   --out <dir>                  Output directory (default: meetings).
 *   --track <n>                  Only transcribe audio stream n (default: all).
 *   --skip-llm                   Write the transcript only; skip the LLM recap.
 *   -h, --help                   Show this help.
 *
 * Every audio track in the file is transcribed and diarized independently.
 * Outputs (in the output dir, prefixed with the input file name):
 *   <name>-meeting-transcript.txt   full transcript
 *   <name>-meeting-recap.md         LLM summary (unless --skip-llm)
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const TranscriptManager = require('../src/transcript-manager');
const { createAIService } = require('../src/ai');
const { createTranscriptionService } = require('../src/transcription');
const { saveMeetingOutputs } = require('../src/meeting-output');
const {
  probeAudioStreams,
  decodeTrackToPcm16,
  PIPELINE_SAMPLE_RATE,
} = require('../src/audio-file-source');

const CONFIDENCE_THRESHOLD = 0.85; // mirrors index.js

function parseArgs(argv) {
  const opts = { input: null, provider: null, out: 'meetings', track: null, skipLlm: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        opts.help = true;
        break;
      case '--provider':
        opts.provider = argv[++i];
        break;
      case '--out':
        opts.out = argv[++i];
        break;
      case '--track':
        opts.track = parseInt(argv[++i], 10);
        break;
      case '--skip-llm':
        opts.skipLlm = true;
        break;
      default:
        if (arg.startsWith('-')) {
          throw new Error(`Unknown option: ${arg}`);
        }
        if (opts.input === null) opts.input = arg;
        else throw new Error(`Unexpected extra argument: ${arg}`);
    }
  }
  return opts;
}

function printUsage() {
  console.log(
    'Usage: node scripts/transcribe-file.js <input-file> ' +
    '[--provider local|deepgram] [--out <dir>] [--track <n>] [--skip-llm]'
  );
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    printUsage();
    process.exit(1);
  }

  if (opts.help || !opts.input) {
    printUsage();
    process.exit(opts.help ? 0 : 1);
  }

  const inputPath = path.resolve(opts.input);
  if (!fs.existsSync(inputPath)) {
    console.error(`Error: file not found: ${inputPath}`);
    process.exit(1);
  }

  // Apply provider override before the factory reads the environment.
  if (opts.provider) process.env.TRANSCRIPTION_PROVIDER = opts.provider.toLowerCase();
  const provider = (process.env.TRANSCRIPTION_PROVIDER || 'deepgram').toLowerCase();
  const deepgramApiKey = process.env.DEEPGRAM_API_KEY;
  if (provider === 'deepgram' && !deepgramApiKey) {
    console.error('Error: DEEPGRAM_API_KEY must be set in .env (or use --provider local)');
    process.exit(1);
  }

  console.log(`--- MeetingTwin File Transcription ---`);
  console.log(`Input:    ${inputPath}`);
  console.log(`Provider: ${provider}`);

  // Discover audio tracks.
  let trackIndices;
  try {
    trackIndices = await probeAudioStreams(inputPath);
  } catch (err) {
    console.error(`Error probing audio streams: ${err.message}`);
    process.exit(1);
  }
  if (opts.track !== null) {
    if (Number.isNaN(opts.track) || !trackIndices.includes(opts.track)) {
      console.error(`Error: track ${opts.track} not found. Available tracks: ${trackIndices.join(', ')}`);
      process.exit(1);
    }
    trackIndices = [opts.track];
  }
  const trackCount = trackIndices.length;
  console.log(`Audio tracks: ${trackCount} (${trackIndices.join(', ')})\n`);

  const transcriptManager = new TranscriptManager();
  const aiClient = opts.skipLlm ? null : createAIService(transcriptManager);
  const baseTimestamp = Date.now();

  for (const trackIndex of trackIndices) {
    console.log(`Decoding track ${trackIndex}...`);
    const pcm = await decodeTrackToPcm16(inputPath, trackIndex);
    console.log(`Transcribing track ${trackIndex} (${(pcm.length / (PIPELINE_SAMPLE_RATE * 2)).toFixed(1)}s of audio)...`);

    const source = trackCount > 1 ? `track${trackIndex}` : 'track0';
    const service = createTranscriptionService(deepgramApiKey);

    service.on('transcription', (evt) => {
      if (evt.confidence !== undefined && evt.confidence < CONFIDENCE_THRESHOLD) return;
      const speaker = evt.speaker ?? 0;
      const label = trackCount > 1 ? `track${trackIndex}-${speaker}` : `speaker-${speaker}`;
      console.log(`[${label}]: ${evt.text}`);
      transcriptManager.addTranscriptEntry(evt.timestamp, label, evt.text, evt.confidence);
    });
    service.on('error', (err) => {
      console.error(`[track ${trackIndex}] Transcription error: ${err.message}`);
    });

    await service.transcribeBatch(pcm, {
      sampleRate: PIPELINE_SAMPLE_RATE,
      source,
      baseTimestamp,
    });
    console.log(`Track ${trackIndex} done.\n`);
  }

  const prefix = path.basename(inputPath, path.extname(inputPath));
  await saveMeetingOutputs(transcriptManager, aiClient, {
    outDir: opts.out,
    prefix,
    skipLlm: opts.skipLlm,
  });

  console.log('\nDone.');
  process.exit(0);
}

main().catch((err) => {
  console.error(`\nFatal error: ${err.message}`);
  process.exit(1);
});
