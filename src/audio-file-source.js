const { spawn } = require('child_process');

// Bundled binaries (no system install required). ffmpeg-static exports the
// path string directly; ffprobe-static exports an object with a `path` field.
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;

const PIPELINE_SAMPLE_RATE = 16000;

/** Runs a binary, resolving with stdout (Buffer) or rejecting with the stderr tail. */
function run(bin, args, { collectStdout = true } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args);
    const stdout = [];
    let stderr = '';

    if (collectStdout) proc.stdout.on('data', (chunk) => stdout.push(chunk));
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout));
      } else {
        const tail = stderr.split('\n').slice(-15).join('\n').trim();
        reject(new Error(`${bin} exited with code ${code}:\n${tail}`));
      }
    });
  });
}

/**
 * Returns the indices of the audio streams in a media file (in container order),
 * e.g. [0] for a single-track file or [0, 1] for one with two audio tracks.
 * The indices are stream-type-relative (usable as ffmpeg's `0:a:<n>` selector).
 */
async function probeAudioStreams(filePath) {
  const out = await run(ffprobePath, [
    '-v', 'error',
    '-print_format', 'json',
    '-show_streams',
    '-select_streams', 'a',
    filePath,
  ]);

  let parsed;
  try {
    parsed = JSON.parse(out.toString());
  } catch (err) {
    throw new Error(`Failed to parse ffprobe output: ${err.message}`);
  }

  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  if (streams.length === 0) {
    throw new Error(`No audio streams found in "${filePath}".`);
  }
  // Return a contiguous 0..n-1 list of audio-relative indices.
  return streams.map((_, i) => i);
}

/**
 * Decodes a single audio track to raw PCM: signed 16-bit little-endian, mono,
 * 16 kHz — exactly what both transcription providers consume.
 *
 * @param {string} filePath
 * @param {number} audioStreamIndex audio-relative index (0 for the first track)
 * @returns {Promise<Buffer>} raw PCM16 mono @16 kHz
 */
async function decodeTrackToPcm16(filePath, audioStreamIndex = 0) {
  return run(ffmpegPath, [
    '-hide_banner',
    '-loglevel', 'error',
    '-i', filePath,
    '-map', `0:a:${audioStreamIndex}`,
    '-ac', '1',
    '-ar', String(PIPELINE_SAMPLE_RATE),
    '-f', 's16le',
    'pipe:1',
  ]);
}

module.exports = {
  probeAudioStreams,
  decodeTrackToPcm16,
  PIPELINE_SAMPLE_RATE,
};
