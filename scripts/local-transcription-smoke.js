// Smoke test for the local transcription provider: streams a 16-bit mono WAV
// file through LocalTranscriptionService in real-time-sized chunks and prints
// the emitted transcription events.
//
// Usage: node scripts/local-transcription-smoke.js <path-to-wav> [language]
// The first run downloads the models (~200 MB with the default base model).
require('dotenv').config();
const fs = require('fs');

const wavPath = process.argv[2];
if (!wavPath || !fs.existsSync(wavPath)) {
  console.error('Usage: node scripts/local-transcription-smoke.js <path-to-wav> [language]');
  process.exit(1);
}
if (process.argv[3]) process.env.LOCAL_TRANSCRIPTION_LANGUAGE = process.argv[3];

const { LocalTranscriptionService } = require('../src/transcription/LocalTranscriptionService.ts');

function parseWav(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a RIFF/WAVE file');
  }
  let offset = 12;
  let format = null;
  let data = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      format = {
        audioFormat: buffer.readUInt16LE(offset + 8),
        channels: buffer.readUInt16LE(offset + 10),
        sampleRate: buffer.readUInt32LE(offset + 12),
        bitsPerSample: buffer.readUInt16LE(offset + 22),
      };
    } else if (id === 'data') {
      data = buffer.subarray(offset + 8, offset + 8 + size);
    }
    offset += 8 + size + (size % 2);
  }
  if (!format || !data) throw new Error('Missing fmt/data chunk');
  if (format.audioFormat !== 1 || format.bitsPerSample !== 16) {
    throw new Error(`Need 16-bit PCM, got format ${format.audioFormat} / ${format.bitsPerSample} bit`);
  }
  if (format.channels !== 1) {
    // Keep only the first channel.
    const frames = data.length / (2 * format.channels);
    const mono = Buffer.alloc(frames * 2);
    for (let i = 0; i < frames; i++) {
      mono.writeInt16LE(data.readInt16LE(i * 2 * format.channels), i * 2);
    }
    data = mono;
  }
  return { sampleRate: format.sampleRate, data };
}

async function main() {
  const { sampleRate, data } = parseWav(fs.readFileSync(wavPath));
  const durationSec = data.length / 2 / sampleRate;
  console.log(`WAV: ${sampleRate} Hz, ${durationSec.toFixed(1)}s, ${data.length} bytes PCM`);

  const service = new LocalTranscriptionService();
  const events = [];
  service.on('transcription', (evt) => {
    events.push(evt);
    console.log(`>>> [speaker ${evt.speaker}] (conf ${evt.confidence}) ${evt.text}`);
  });
  service.on('error', (err) => console.error('ERROR:', err.message));

  const start = Date.now();
  await new Promise((resolve, reject) => {
    service.once('connected', resolve);
    service.once('disconnected', () => reject(new Error('init failed')));
    service.connect(sampleRate, 'smoke');
  });
  console.log(`Connected in ${((Date.now() - start) / 1000).toFixed(1)}s. Streaming audio...`);

  const chunkBytes = Math.floor(sampleRate * 0.1) * 2; // 100ms chunks
  for (let off = 0; off < data.length; off += chunkBytes) {
    service.sendAudio(data.subarray(off, off + chunkBytes));
  }
  // Trailing silence so the VAD closes the last utterance.
  const silence = Buffer.alloc(chunkBytes);
  for (let i = 0; i < 20; i++) service.sendAudio(silence);

  // Give the inference queue time to drain, then disconnect.
  await new Promise((r) => setTimeout(r, 30000));
  service.disconnect();
  await new Promise((r) => setTimeout(r, 1000));

  console.log(`\nDone: ${events.length} utterance(s) emitted.`);
  process.exit(events.length > 0 ? 0 : 2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
