/**
 * Configuration manager for MeetingTwin GUI
 * Manages per-session configuration (in-memory, not persisted to .env)
 */

const MANAGED_KEYS = {
  transcriptionProvider: 'TRANSCRIPTION_PROVIDER',
  audioDeviceIdMic: 'AUDIO_DEVICE_ID_MIC',
  audioDeviceIdSystem: 'AUDIO_DEVICE_ID_SYSTEM',
  isLiveMeeting: 'IS_LIVE_MEETING',
  skipLlm: 'SKIP_LLM',
  deepgramLanguage: 'DEEPGRAM_LANGUAGE',
  localWhisperModel: 'LOCAL_WHISPER_MODEL',
  localTranscriptionLanguage: 'LOCAL_TRANSCRIPTION_LANGUAGE',
};

class ConfigManager {
  constructor() {
    this.config = this._loadFromEnv();
  }

  /**
   * Load initial configuration from process.env
   * @private
   * @returns {object} Initial configuration
   */
  _loadFromEnv() {
    return {
      transcriptionProvider: process.env.TRANSCRIPTION_PROVIDER || 'deepgram',
      audioDeviceIdMic: process.env.AUDIO_DEVICE_ID_MIC || '',
      audioDeviceIdSystem: process.env.AUDIO_DEVICE_ID_SYSTEM || '',
      isLiveMeeting: process.env.IS_LIVE_MEETING === 'true',
      skipLlm: process.env.SKIP_LLM === 'true',
      deepgramLanguage: process.env.DEEPGRAM_LANGUAGE || 'en',
      localWhisperModel: process.env.LOCAL_WHISPER_MODEL || 'base',
      localTranscriptionLanguage: process.env.LOCAL_TRANSCRIPTION_LANGUAGE || 'en',
    };
  }

  /**
   * Get defensive copy of current configuration
   * @returns {object} Current configuration (defensive copy)
   */
  get() {
    return JSON.parse(JSON.stringify(this.config));
  }

  /**
   * Update configuration with partial values
   * Validates inputs and merges with existing config
   * @param {object} partial - Partial configuration to merge
   * @throws {Error} If validation fails
   * @returns {object} Updated configuration
   */
  update(partial) {
    if (!partial || typeof partial !== 'object') {
      throw new Error('Configuration must be an object');
    }

    // Create a test config to validate
    const testConfig = { ...this.config, ...partial };

    // Validate each provided field
    for (const [key, value] of Object.entries(partial)) {
      // Ignore unknown keys (per spec: "ignora chiavi sconosciute")
      if (!(key in MANAGED_KEYS)) {
        continue;
      }

      // Validate transcriptionProvider
      if (key === 'transcriptionProvider') {
        const provider = String(value).toLowerCase();
        if (!['deepgram', 'local'].includes(provider)) {
          throw new Error(`transcriptionProvider must be 'deepgram' or 'local', got '${value}'`);
        }
      }

      // Validate audioDeviceIdMic and audioDeviceIdSystem (string numeric or empty)
      if (key === 'audioDeviceIdMic' || key === 'audioDeviceIdSystem') {
        const strValue = String(value);
        if (strValue !== '' && !/^\d+$/.test(strValue)) {
          throw new Error(`${key} must be a numeric string or empty, got '${value}'`);
        }
      }

      // Validate isLiveMeeting and skipLlm (boolean)
      if (key === 'isLiveMeeting' || key === 'skipLlm') {
        if (typeof value !== 'boolean') {
          throw new Error(`${key} must be a boolean, got ${typeof value}`);
        }
      }

      // Validate localWhisperModel (only if set)
      if (key === 'localWhisperModel' && value) {
        const model = String(value).toLowerCase();
        if (!['tiny', 'base', 'small', 'medium', 'large-v3'].includes(model)) {
          throw new Error(`localWhisperModel must be 'tiny', 'base', 'small', 'medium', or 'large-v3', got '${value}'`);
        }
      }

      // Validate language fields (short string, no rigid validation)
      if (key === 'deepgramLanguage' || key === 'localTranscriptionLanguage') {
        if (typeof value !== 'string') {
          throw new Error(`${key} must be a string, got ${typeof value}`);
        }
      }
    }

    // Merge configuration (ignore unknown keys)
    const merged = {};
    for (const key of Object.keys(MANAGED_KEYS)) {
      if (key in partial) {
        merged[key] = partial[key];
      }
    }

    this.config = { ...this.config, ...merged };
    return this.get();
  }

  /**
   * Apply current configuration to process.env
   * Converts boolean values to 'true'/'false' strings
   */
  applyToEnv() {
    for (const [configKey, envKey] of Object.entries(MANAGED_KEYS)) {
      const value = this.config[configKey];

      if (typeof value === 'boolean') {
        process.env[envKey] = value ? 'true' : 'false';
      } else {
        process.env[envKey] = String(value);
      }
    }
  }
}

module.exports = { ConfigManager, MANAGED_KEYS };
