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
 *   --context <file.md>          Markdown file with extra context for the recap.
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

const { transcribeFile } = require('../src/batch-transcription');

function parseArgs(argv) {
  const opts = { input: null, provider: null, out: 'meetings', track: null, skipLlm: false, contextFile: null };
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
      case '--context':
        opts.contextFile = argv[++i];
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
    '[--provider local|deepgram] [--out <dir>] [--track <n>] [--skip-llm] [--context <file.md>]'
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

  // Load the optional context file (must exist if provided)
  let userContext = '';
  if (opts.contextFile) {
    try {
      userContext = fs.readFileSync(opts.contextFile, 'utf8');
      console.log(`Context loaded from ${opts.contextFile}`);
    } catch (err) {
      console.error(`Error: failed to read context file "${opts.contextFile}": ${err.message}`);
      process.exit(1);
    }
  }

  // Determine provider for banner output
  const providerForBanner = opts.provider || process.env.TRANSCRIPTION_PROVIDER || 'deepgram';
  console.log(`--- MeetingTwin File Transcription ---`);
  console.log(`Input:    ${inputPath}`);
  console.log(`Provider: ${providerForBanner}\n`);

  // Event handler to print progress matching the original script output
  function handleEvent(evt) {
    switch (evt.state) {
      case 'probing':
        break; // No output for probing
      case 'decoding':
        console.log(`Decoding track ${evt.track}...`);
        break;
      case 'transcribing':
        console.log(`Transcribing track ${evt.track} (${evt.durationSec}s of audio)...`);
        break;
      case 'transcription':
        console.log(`[${evt.label}]: ${evt.text}`);
        break;
      case 'transcription-error':
        console.error(`[track ${evt.track}] Transcription error: ${evt.message}`);
        break;
      case 'track-done':
        console.log(`Track ${evt.track} done.\n`);
        break;
      case 'saving':
        break; // No output during saving
      case 'done':
        console.log(`\nTranscript saved to ${evt.outputs.transcriptPath}`);
        if (evt.outputs.recapPath) {
          console.log(`Recap saved to ${evt.outputs.recapPath}`);
        }
        break;
      case 'error':
        console.error(`Error: ${evt.message}`);
        break;
    }
  }

  try {
    await transcribeFile(inputPath, {
      provider: opts.provider,
      track: opts.track,
      skipLlm: opts.skipLlm,
      outDir: opts.out,
      userContext,
      onEvent: handleEvent,
    });
    console.log('\nDone.');
    process.exit(0);
  } catch (err) {
    console.error(`\nFatal error: ${err.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\nFatal error: ${err.message}`);
  process.exit(1);
});
