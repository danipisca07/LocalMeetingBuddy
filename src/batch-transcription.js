const fs = require('fs');
const path = require('path');

const TranscriptManager = require('./transcript-manager');
const { createAIService } = require('./ai');
const { createTranscriptionService } = require('./transcription');
const { saveMeetingOutputs } = require('./meeting-output');
const {
  probeAudioStreams,
  decodeTrackToPcm16,
  PIPELINE_SAMPLE_RATE,
} = require('./audio-file-source');

const CONFIDENCE_THRESHOLD = 0.85; // mirrors index.js

/**
 * Transcribe every audio track of a file with the same pipeline as the CLI script.
 *
 * @param {string} inputPath  absolute path of the input file (already validated existing)
 * @param {{
 *   provider?: string|null,      // 'local'|'deepgram'|null → null = use env
 *   track?: number|null,         // only this audio stream (null = all)
 *   skipLlm?: boolean,
 *   outDir?: string,             // default 'meetings'
 *   confidenceThreshold?: number,// default 0.85
 *   onEvent?: (evt) => void,     // progress callback
 * }} options
 * @returns {Promise<{outputs: {transcriptPath: string, recapPath: string|null}, prefix: string}>}
 */
async function transcribeFile(inputPath, options = {}) {
  const {
    provider = null,
    track: trackOption = null,
    skipLlm = false,
    outDir = 'meetings',
    confidenceThreshold = CONFIDENCE_THRESHOLD,
    onEvent = () => {},
  } = options;

  // Save original provider setting so we can restore it
  const originalProvider = process.env.TRANSCRIPTION_PROVIDER;

  try {
    // Override provider if specified
    if (provider) {
      process.env.TRANSCRIPTION_PROVIDER = provider.toLowerCase();
    }

    const currentProvider = (process.env.TRANSCRIPTION_PROVIDER || 'deepgram').toLowerCase();
    const deepgramApiKey = process.env.DEEPGRAM_API_KEY;

    // Check for deepgram API key if needed
    if (currentProvider === 'deepgram' && !deepgramApiKey) {
      throw new Error('DEEPGRAM_API_KEY must be set in .env (or use --provider local)');
    }

    // Probe audio streams
    onEvent({ state: 'probing' });
    let trackIndices = await probeAudioStreams(inputPath);

    // Filter to specific track if requested
    if (trackOption !== null) {
      if (Number.isNaN(trackOption) || !trackIndices.includes(trackOption)) {
        throw new Error(`track ${trackOption} not found. Available tracks: ${trackIndices.join(', ')}`);
      }
      trackIndices = [trackOption];
    }

    const trackCount = trackIndices.length;
    const transcriptManager = new TranscriptManager();
    const aiClient = skipLlm ? null : createAIService(transcriptManager);
    const baseTimestamp = Date.now();

    // Transcode each track
    for (const trackIndex of trackIndices) {
      onEvent({ state: 'decoding', track: trackIndex, totalTracks: trackCount });
      const pcm = await decodeTrackToPcm16(inputPath, trackIndex);

      const durationSec = (pcm.length / (PIPELINE_SAMPLE_RATE * 2)).toFixed(1);
      onEvent({ state: 'transcribing', track: trackIndex, totalTracks: trackCount, durationSec });

      const source = trackCount > 1 ? `track${trackIndex}` : 'track0';
      const service = createTranscriptionService(deepgramApiKey);

      // Wire up transcription events
      service.on('transcription', (evt) => {
        if (evt.confidence !== undefined && evt.confidence < confidenceThreshold) return;
        const speaker = evt.speaker ?? 0;
        const label = trackCount > 1 ? `track${trackIndex}-${speaker}` : `speaker-${speaker}`;
        onEvent({ state: 'transcription', label, text: evt.text });
        transcriptManager.addTranscriptEntry(evt.timestamp, label, evt.text, evt.confidence);
      });

      service.on('error', (err) => {
        onEvent({ state: 'transcription-error', track: trackIndex, message: err.message });
      });

      // Perform transcription
      await service.transcribeBatch(pcm, {
        sampleRate: PIPELINE_SAMPLE_RATE,
        source,
        baseTimestamp,
      });

      onEvent({ state: 'track-done', track: trackIndex });
    }

    // Save outputs
    onEvent({ state: 'saving' });
    const prefix = path.basename(inputPath, path.extname(inputPath));

    // Ensure output directory exists
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    // Save transcript and recap
    const transcriptPath = path.join(outDir, `${prefix}-meeting-transcript.txt`);
    fs.writeFileSync(transcriptPath, transcriptManager.getTranscript());

    let recapPath = null;
    if (!skipLlm && aiClient) {
      try {
        const recapPrompt = loadRecapPrompt();
        const recap = await aiClient.query(recapPrompt);
        recapPath = path.join(outDir, `${prefix}-meeting-recap.md`);
        fs.writeFileSync(recapPath, recap);
      } catch (err) {
        // If recap generation fails, still report success for the transcript
        console.error(`Error generating recap: ${err.message}`);
      }
    }

    onEvent({
      state: 'done',
      outputs: {
        transcriptPath,
        recapPath,
      },
      prefix,
    });

    return {
      outputs: {
        transcriptPath,
        recapPath,
      },
      prefix,
    };
  } finally {
    // Restore original provider setting
    if (provider) {
      process.env.TRANSCRIPTION_PROVIDER = originalProvider;
    }
  }
}

/**
 * Load the recap prompt from file or return fallback
 */
function loadRecapPrompt() {
  const recapPromptFile = path.join(__dirname, '..', 'prompts', 'recap-prompt.md');
  const fallback = "Create a meeting recap in Italian. Format the output in Markdown.";
  try {
    return fs.readFileSync(recapPromptFile, 'utf8');
  } catch {
    return fallback;
  }
}

module.exports = { transcribeFile };
