const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { transcribeFile } = require('../src/batch-transcription');

describe('batch-transcription', () => {
  it('rejects when file does not exist', async () => {
    const nonExistentPath = path.resolve('/nonexistent/file.mp4');
    await assert.rejects(
      () => transcribeFile(nonExistentPath, { provider: 'local' }),
      (err) => err.message.includes('not found') || err.message.includes('No such file')
    );
  });

  it('rejects when track number does not exist', async () => {
    const fixture = path.join(__dirname, 'fixtures', 'italian-two-speakers.wav');
    // Assuming this fixture has only 1 audio track (track 0)
    await assert.rejects(
      () => transcribeFile(fixture, { provider: 'local', track: 999 }),
      (err) => err.message.includes('not found')
    );
  });

  it('restores process.env.TRANSCRIPTION_PROVIDER after override', async () => {
    const originalProvider = process.env.TRANSCRIPTION_PROVIDER;
    try {
      process.env.TRANSCRIPTION_PROVIDER = 'local';
      const nonExistentPath = path.resolve('/nonexistent/file.mp4');
      try {
        await transcribeFile(nonExistentPath, { provider: 'deepgram' });
      } catch (err) {
        // Expected to fail on file not found
      }
      // Should be restored to original
      assert.strictEqual(process.env.TRANSCRIPTION_PROVIDER, 'local');
    } finally {
      process.env.TRANSCRIPTION_PROVIDER = originalProvider;
    }
  });

  it('rejects deepgram provider without API key', async () => {
    const originalKey = process.env.DEEPGRAM_API_KEY;
    delete process.env.DEEPGRAM_API_KEY;
    try {
      const fixture = path.join(__dirname, 'fixtures', 'italian-two-speakers.wav');
      await assert.rejects(
        () => transcribeFile(fixture, { provider: 'deepgram' }),
        (err) => err.message.includes('DEEPGRAM_API_KEY')
      );
    } finally {
      if (originalKey) process.env.DEEPGRAM_API_KEY = originalKey;
    }
  });

  it('calls onEvent callback with expected states', async () => {
    const fixture = path.join(__dirname, 'fixtures', 'italian-two-speakers.wav');
    const events = [];

    try {
      await transcribeFile(fixture, {
        provider: 'local',
        skipLlm: true,
        onEvent: (evt) => events.push(evt),
      });

      // Check that we got probing and other core states
      const stateNames = events.map((e) => e.state);
      assert.ok(stateNames.includes('probing'), 'should have probing state');
      assert.ok(stateNames.includes('decoding') || stateNames.includes('done'), 'should have decoding or skip to done');
      assert.ok(stateNames.includes('done'), 'should end with done state');
    } catch (err) {
      // May fail if whisper model not available, which is acceptable for CI
      if (!err.message.includes('model') && !err.message.includes('download')) {
        throw err;
      }
    }
  });
});
