const { test, describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

// Ensure we have a mock API key for tests to avoid process.exit in createAIService
if (!process.env.ANTHROPIC_API_KEY && !process.env.GROQ_API_KEY) {
  process.env.ANTHROPIC_API_KEY = 'test-mock-key';
}

const { MeetingSession } = require('../src/meeting-session');

describe('MeetingSession', () => {
  it('should throw error when transcriptionProvider is deepgram without apiKey', () => {
    // Mock process.env temporarily
    const originalDeepgramKey = process.env.DEEPGRAM_API_KEY;
    const originalProvider = process.env.TRANSCRIPTION_PROVIDER;

    delete process.env.DEEPGRAM_API_KEY;
    process.env.TRANSCRIPTION_PROVIDER = 'deepgram';

    try {
      assert.throws(() => {
        new MeetingSession({
          transcriptionProvider: 'deepgram',
          deepgramApiKey: undefined
        });
      }, /DEEPGRAM_API_KEY must be set/);
    } finally {
      // Restore environment
      if (originalDeepgramKey) {
        process.env.DEEPGRAM_API_KEY = originalDeepgramKey;
      } else {
        delete process.env.DEEPGRAM_API_KEY;
      }
      if (originalProvider) {
        process.env.TRANSCRIPTION_PROVIDER = originalProvider;
      } else {
        delete process.env.TRANSCRIPTION_PROVIDER;
      }
    }
  });

  it('should not throw error when transcriptionProvider is local', () => {
    assert.doesNotThrow(() => {
      new MeetingSession({
        transcriptionProvider: 'local'
      });
    });
  });

  it('should accept deepgram provider with apiKey', () => {
    assert.doesNotThrow(() => {
      new MeetingSession({
        transcriptionProvider: 'deepgram',
        deepgramApiKey: 'test-api-key'
      });
    });
  });

  it('should not be running initially', () => {
    const session = new MeetingSession({
      transcriptionProvider: 'local'
    });

    assert.strictEqual(session.isRunning, false);
  });

  it('should handle transcription event with confidence filtering', () => {
    const session = new MeetingSession({
      transcriptionProvider: 'local',
      confidenceThreshold: 0.85,
      isLiveMeeting: false
    });

    let emittedEvent = null;

    session.on('transcription', (evt) => {
      emittedEvent = evt;
    });

    // Test high confidence (should pass)
    session._handleTranscriptionEvent({
      text: 'Hello world',
      confidence: 0.95,
      source: 'user',
      speaker: undefined,
      timestamp: Date.now()
    });

    assert.ok(emittedEvent !== null);
    assert.strictEqual(emittedEvent.text, 'Hello world');
    assert.strictEqual(emittedEvent.confidence, 0.95);

    // Test low confidence (should be filtered)
    emittedEvent = null;
    session._handleTranscriptionEvent({
      text: 'Low confidence text',
      confidence: 0.75,
      source: 'user',
      speaker: undefined,
      timestamp: Date.now()
    });

    assert.strictEqual(emittedEvent, null);
  });

  it('should handle transcription event without confidence', () => {
    const session = new MeetingSession({
      transcriptionProvider: 'local',
      confidenceThreshold: 0.85,
      isLiveMeeting: false
    });

    let emittedEvent = null;

    session.on('transcription', (evt) => {
      emittedEvent = evt;
    });

    // Event without confidence should pass
    session._handleTranscriptionEvent({
      text: 'Text without confidence',
      confidence: undefined,
      source: 'user',
      speaker: undefined,
      timestamp: Date.now()
    });

    assert.ok(emittedEvent !== null);
    assert.strictEqual(emittedEvent.text, 'Text without confidence');
  });

  it('should use displaySource from determineDisplaySource', () => {
    const session = new MeetingSession({
      transcriptionProvider: 'local',
      isLiveMeeting: false
    });

    let emittedEvent = null;

    session.on('transcription', (evt) => {
      emittedEvent = evt;
    });

    session._handleTranscriptionEvent({
      text: 'User input',
      confidence: 0.95,
      source: 'user',
      speaker: undefined,
      timestamp: Date.now()
    });

    assert.ok(emittedEvent !== null);
    assert.strictEqual(emittedEvent.source, 'user');
  });

  it('should initialize config with defaults and environment', () => {
    const session = new MeetingSession({
      transcriptionProvider: 'local',
      sampleRate: 8000
    });

    assert.strictEqual(session.config.transcriptionProvider, 'local');
    assert.strictEqual(session.config.sampleRate, 8000);
    assert.strictEqual(session.config.confidenceThreshold, 0.85);
  });

  it('should have getTranscript method', () => {
    const session = new MeetingSession({
      transcriptionProvider: 'local'
    });

    const transcript = session.getTranscript();
    assert.strictEqual(typeof transcript, 'string');
  });

  it('should propagate userContext from config to the AI client', () => {
    const session = new MeetingSession({
      transcriptionProvider: 'local',
      userContext: 'Project name: Apollo'
    });

    assert.strictEqual(session.config.userContext, 'Project name: Apollo');

    let received = null;
    session.aiClient.setUserContext = (text) => { received = text; };

    session.setUserContext('Updated context');
    assert.strictEqual(session.config.userContext, 'Updated context');
    assert.strictEqual(received, 'Updated context');
  });

  it('should default userContext to empty string and normalize falsy updates', () => {
    const session = new MeetingSession({
      transcriptionProvider: 'local'
    });

    assert.strictEqual(session.config.userContext, '');

    session.setUserContext(null);
    assert.strictEqual(session.config.userContext, '');
  });

  it('should throw if session is already running on start', async () => {
    const session = new MeetingSession({
      transcriptionProvider: 'local'
    });

    // Mark as running without actually starting
    session._isRunning = true;

    await assert.rejects(
      () => session.start(),
      /already running/
    );
  });

  it('should be idempotent on stop when not running', async () => {
    const session = new MeetingSession({
      transcriptionProvider: 'local'
    });

    // Should not throw
    await assert.doesNotReject(() => session.stop({ save: false }));
  });
});
