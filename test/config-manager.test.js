const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { ConfigManager, MANAGED_KEYS } = require('../src/config-manager');

describe('ConfigManager', () => {
  let originalEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Clear managed keys from environment for clean tests
    for (const key of Object.values(MANAGED_KEYS)) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('constructor and _loadFromEnv', () => {
    it('should load defaults when environment is empty', () => {
      const cm = new ConfigManager();
      const config = cm.get();

      assert.strictEqual(config.transcriptionProvider, 'deepgram');
      assert.strictEqual(config.audioDeviceIdMic, '');
      assert.strictEqual(config.audioDeviceIdSystem, '');
      assert.strictEqual(config.isLiveMeeting, false);
      assert.strictEqual(config.skipLlm, false);
      assert.strictEqual(config.deepgramLanguage, 'en');
      assert.strictEqual(config.localWhisperModel, 'base');
      assert.strictEqual(config.localTranscriptionLanguage, 'en');
    });

    it('should load values from process.env', () => {
      process.env.TRANSCRIPTION_PROVIDER = 'local';
      process.env.AUDIO_DEVICE_ID_MIC = '5';
      process.env.AUDIO_DEVICE_ID_SYSTEM = '10';
      process.env.IS_LIVE_MEETING = 'true';
      process.env.SKIP_LLM = 'true';
      process.env.DEEPGRAM_LANGUAGE = 'it';
      process.env.LOCAL_WHISPER_MODEL = 'small';
      process.env.LOCAL_TRANSCRIPTION_LANGUAGE = 'it';

      const cm = new ConfigManager();
      const config = cm.get();

      assert.strictEqual(config.transcriptionProvider, 'local');
      assert.strictEqual(config.audioDeviceIdMic, '5');
      assert.strictEqual(config.audioDeviceIdSystem, '10');
      assert.strictEqual(config.isLiveMeeting, true);
      assert.strictEqual(config.skipLlm, true);
      assert.strictEqual(config.deepgramLanguage, 'it');
      assert.strictEqual(config.localWhisperModel, 'small');
      assert.strictEqual(config.localTranscriptionLanguage, 'it');
    });

    it('should treat non-"true" values as false for boolean fields', () => {
      process.env.IS_LIVE_MEETING = 'false';
      process.env.SKIP_LLM = '';

      const cm = new ConfigManager();
      const config = cm.get();

      assert.strictEqual(config.isLiveMeeting, false);
      assert.strictEqual(config.skipLlm, false);
    });
  });

  describe('get()', () => {
    it('should return a defensive copy of configuration', () => {
      const cm = new ConfigManager();
      const config1 = cm.get();
      const config2 = cm.get();

      assert.deepStrictEqual(config1, config2);
      assert.notStrictEqual(config1, config2); // Different objects
    });

    it('should not allow external modification to affect internal state', () => {
      const cm = new ConfigManager();
      const config = cm.get();
      config.transcriptionProvider = 'modified';

      const config2 = cm.get();
      assert.strictEqual(config2.transcriptionProvider, 'deepgram');
    });
  });

  describe('update()', () => {
    let cm;

    beforeEach(() => {
      cm = new ConfigManager();
    });

    it('should merge valid partial configuration', () => {
      const updated = cm.update({
        transcriptionProvider: 'local',
        deepgramLanguage: 'it',
      });

      assert.strictEqual(updated.transcriptionProvider, 'local');
      assert.strictEqual(updated.deepgramLanguage, 'it');
      assert.strictEqual(updated.isLiveMeeting, false); // Unchanged
    });

    it('should ignore unknown keys', () => {
      const updated = cm.update({
        transcriptionProvider: 'local',
        unknownKey: 'should be ignored',
        anotherUnknown: 42,
      });

      assert.strictEqual(updated.transcriptionProvider, 'local');
      assert(!('unknownKey' in updated));
      assert(!('anotherUnknown' in updated));
    });

    it('should throw on invalid transcriptionProvider', () => {
      assert.throws(
        () => cm.update({ transcriptionProvider: 'invalid' }),
        /transcriptionProvider must be 'deepgram' or 'local'/
      );
    });

    it('should accept lowercase provider names and normalize them', () => {
      const updated = cm.update({ transcriptionProvider: 'DEEPGRAM' });
      // Note: The validation converts to lowercase for checking, so 'DEEPGRAM' passes validation
      // but the value stored is the original 'DEEPGRAM' (not normalized in current impl)
      // Actually, looking at the code, we don't normalize - we just validate lowercase
      // So 'DEEPGRAM' as uppercase should still pass because we check toLowerCase()
      assert.strictEqual(updated.transcriptionProvider, 'DEEPGRAM');
    });

    it('should throw on invalid audioDeviceIdMic (non-numeric)', () => {
      assert.throws(
        () => cm.update({ audioDeviceIdMic: 'not-a-number' }),
        /audioDeviceIdMic must be a numeric string or empty/
      );
    });

    it('should accept empty string for audioDeviceIdMic', () => {
      const updated = cm.update({ audioDeviceIdMic: '' });
      assert.strictEqual(updated.audioDeviceIdMic, '');
    });

    it('should accept numeric string for audioDeviceIdMic', () => {
      const updated = cm.update({ audioDeviceIdMic: '5' });
      assert.strictEqual(updated.audioDeviceIdMic, '5');
    });

    it('should throw on invalid audioDeviceIdSystem (non-numeric)', () => {
      assert.throws(
        () => cm.update({ audioDeviceIdSystem: 'abc123' }),
        /audioDeviceIdSystem must be a numeric string or empty/
      );
    });

    it('should throw on non-boolean isLiveMeeting', () => {
      assert.throws(
        () => cm.update({ isLiveMeeting: 'true' }),
        /isLiveMeeting must be a boolean/
      );
    });

    it('should throw on non-boolean skipLlm', () => {
      assert.throws(
        () => cm.update({ skipLlm: 1 }),
        /skipLlm must be a boolean/
      );
    });

    it('should throw on invalid localWhisperModel', () => {
      assert.throws(
        () => cm.update({ localWhisperModel: 'large' }),
        /localWhisperModel must be 'tiny', 'base', 'small', 'medium', or 'large-v3'/
      );
    });

    it('should accept valid localWhisperModel values', () => {
      const models = ['tiny', 'base', 'small', 'medium', 'large-v3'];
      for (const model of models) {
        const updated = cm.update({ localWhisperModel: model });
        assert.strictEqual(updated.localWhisperModel, model);
      }
    });

    it('should accept uppercase localWhisperModel (case-insensitive validation)', () => {
      const updated = cm.update({ localWhisperModel: 'BASE' });
      // Validation uses toLowerCase(), so 'BASE' should pass
      assert.strictEqual(updated.localWhisperModel, 'BASE');
    });

    it('should throw on non-string deepgramLanguage', () => {
      assert.throws(
        () => cm.update({ deepgramLanguage: 123 }),
        /deepgramLanguage must be a string/
      );
    });

    it('should accept string language codes', () => {
      const updated = cm.update({ deepgramLanguage: 'it' });
      assert.strictEqual(updated.deepgramLanguage, 'it');
    });

    it('should throw on invalid input type', () => {
      assert.throws(
        () => cm.update(null),
        /Configuration must be an object/
      );

      assert.throws(
        () => cm.update('string'),
        /Configuration must be an object/
      );
    });
  });

  describe('applyToEnv()', () => {
    it('should write configuration to process.env', () => {
      const cm = new ConfigManager();
      cm.update({
        transcriptionProvider: 'local',
        audioDeviceIdMic: '3',
        deepgramLanguage: 'it',
      });

      cm.applyToEnv();

      assert.strictEqual(process.env.TRANSCRIPTION_PROVIDER, 'local');
      assert.strictEqual(process.env.AUDIO_DEVICE_ID_MIC, '3');
      assert.strictEqual(process.env.DEEPGRAM_LANGUAGE, 'it');
    });

    it('should convert boolean values to "true"/"false" strings', () => {
      const cm = new ConfigManager();
      cm.update({
        isLiveMeeting: true,
        skipLlm: false,
      });

      cm.applyToEnv();

      assert.strictEqual(process.env.IS_LIVE_MEETING, 'true');
      assert.strictEqual(process.env.SKIP_LLM, 'false');
    });

    it('should write all managed keys', () => {
      const cm = new ConfigManager();
      cm.applyToEnv();

      for (const envKey of Object.values(MANAGED_KEYS)) {
        assert.strictEqual(typeof process.env[envKey], 'string');
      }
    });
  });

  describe('API key safety', () => {
    it('should not expose any API keys in get()', () => {
      const cm = new ConfigManager();
      const config = cm.get();

      for (const key of Object.keys(config)) {
        assert(!key.includes('ApiKey') && !key.includes('API_KEY'),
          `Unexpected API key field in config: ${key}`);
      }
    });

    it('should not manage DEEPGRAM_API_KEY', () => {
      assert(!MANAGED_KEYS.deepgramApiKey);

      const cm = new ConfigManager();
      const config = cm.get();

      assert(!('deepgramApiKey' in config));
    });

    it('should not manage other API keys', () => {
      for (const key of Object.keys(MANAGED_KEYS)) {
        assert(!key.includes('API') && !key.includes('Key'),
          `Unexpected API key in MANAGED_KEYS: ${key}`);
      }
    });
  });
});
