const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ffmpegPath = require('ffmpeg-static');
const {
  probeAudioStreams,
  decodeTrackToPcm16,
  PIPELINE_SAMPLE_RATE,
} = require('../src/audio-file-source');
const { pcmToWav } = require('../src/transcription/wav.ts');

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    let stderr = '';
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg failed (${code}): ${stderr.slice(-300)}`))
    );
  });
}

describe('pcmToWav', () => {
  it('prepends a valid 44-byte PCM WAV header', () => {
    const pcm = Buffer.alloc(100);
    const wav = pcmToWav(pcm, 16000, 1);

    assert.strictEqual(wav.length, 144);
    assert.strictEqual(wav.toString('ascii', 0, 4), 'RIFF');
    assert.strictEqual(wav.toString('ascii', 8, 12), 'WAVE');
    assert.strictEqual(wav.readUInt16LE(20), 1); // PCM format
    assert.strictEqual(wav.readUInt16LE(22), 1); // channels
    assert.strictEqual(wav.readUInt32LE(24), 16000); // sample rate
    assert.strictEqual(wav.readUInt16LE(34), 16); // bits per sample
    assert.strictEqual(wav.toString('ascii', 36, 40), 'data');
    assert.strictEqual(wav.readUInt32LE(40), 100); // data chunk size
  });
});

describe('audio-file-source (real ffmpeg)', () => {
  let tmpDir;
  let twoTrackFile;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-decode-'));
    twoTrackFile = path.join(tmpDir, 'two-track.mkv');
    // Two 1s sine tones as two separate audio streams.
    await runFfmpeg([
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
      '-f', 'lavfi', '-i', 'sine=frequency=880:duration=1',
      '-map', '0:a', '-map', '1:a',
      twoTrackFile,
    ]);
  });

  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('detects every audio track', async () => {
    const tracks = await probeAudioStreams(twoTrackFile);
    assert.deepStrictEqual(tracks, [0, 1]);
  });

  it('decodes a track to ~1s of 16 kHz mono PCM16', async () => {
    const pcm = await decodeTrackToPcm16(twoTrackFile, 0);
    const seconds = pcm.length / (PIPELINE_SAMPLE_RATE * 2);
    assert.ok(seconds > 0.9 && seconds < 1.2, `expected ~1s, got ${seconds.toFixed(2)}s`);
    assert.strictEqual(pcm.length % 2, 0); // whole 16-bit samples
  });

  it('rejects when the file has no audio streams', async () => {
    await assert.rejects(() => probeAudioStreams(path.join(tmpDir, 'does-not-exist.mp4')));
  });
});
