require('dotenv').config();
const readline = require('readline');
const AudioCapture = require('./audio-capture');
const TranscriptionService = require('./transcription');
const TranscriptManager = require('./transcript-manager');
const ClaudeClient = require('./claude-client');
const GroqClient = require('./groq-client');
const fs = require('fs');

// Configuration
const SAMPLE_RATE = 16000;
const CONFIDENCE_THRESHOLD = 0.85; // requirement: > 0.85
const deepgramApiKey = process.env.DEEPGRAM_API_KEY;

if (!deepgramApiKey) {
  console.error('Error: DEEPGRAM_API_KEY must be set in .env');
  process.exit(1);
}

const micCapture = new AudioCapture({ 
  sampleRate: SAMPLE_RATE,
  deviceId: process.env.AUDIO_DEVICE_ID_MIC
});
const sysCapture = new AudioCapture({ 
  sampleRate: SAMPLE_RATE,
  deviceId: process.env.AUDIO_DEVICE_ID_SYSTEM
});
const micTranscription = new TranscriptionService(deepgramApiKey);
const sysTranscription = new TranscriptionService(deepgramApiKey);
const transcriptManager = new TranscriptManager();
//const aiClient = new ClaudeClient(transcriptManager);
const aiClient = new GroqClient(transcriptManager);

// Setup Readline for Terminal UI
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'MeetingTwin > '
});

console.log('--- MeetingTwin AI Assistant ---');
console.log('Initializing audio and transcription...');

micTranscription.on('transcription', (evt) => {
  if (evt.confidence === undefined || evt.confidence >= CONFIDENCE_THRESHOLD) {
    console.log(`[user]: ${evt.text}`);
    transcriptManager.addTranscriptEntry(evt.timestamp, 'user', evt.text, evt.confidence);
    rl.prompt(true);
  }
});
sysTranscription.on('transcription', (evt) => {
  if (evt.confidence === undefined || evt.confidence >= CONFIDENCE_THRESHOLD) {
    var source = evt.speaker ?? 'unknown caller';
    console.log(`[${source}]: ${evt.text}`);
    transcriptManager.addTranscriptEntry(evt.timestamp, source, evt.text, evt.confidence);
    rl.prompt(true);
  }
});

micTranscription.on('connected', () => {
  micCapture.start();
});
sysTranscription.on('connected', () => {
  sysCapture.start();
});

micTranscription.on('error', (err) => {
  console.error('Mic transcription error:', err.message);
});
sysTranscription.on('error', (err) => {
  console.error('System transcription error:', err.message);
});

micCapture.on('audio', (data) => {
  micTranscription.sendAudio(data);
});
sysCapture.on('audio', (data) => {
  sysTranscription.sendAudio(data);
});

micCapture.on('error', (err) => {
  console.error('Mic audio error:', err.message);
});
sysCapture.on('error', (err) => {
  console.error('System audio error:', err.message);
});

// Main Loop
async function startApp() {
  try {
    micCapture.initialize();
    sysCapture.initialize();
    micTranscription.connect(micCapture.sampleRate, 'user');
    sysTranscription.connect(sysCapture.sampleRate, 'caller');
    
    rl.prompt();

    rl.on('line', async (line) => {
      const input = line.trim();
      
      if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
        if(process.env.SKIP_LLM !== 'true') {
          const recap = await aiClient.query('Crea un recap del meeting in italiano. Formatta l\'output in Markdown.');
          console.log(`\nMeeting Recap: ${recap}\n`);
          fs.writeFileSync(`meetings/${(new Date()).toISOString().slice(0, 16).replace(':', '')}-meeting-recap.md`, recap);
        }

        // save transcript to file
        fs.writeFileSync(`meetings/${(new Date()).toISOString().slice(0, 16).replace(':', '')}-meeting-transcript.txt`, transcriptManager.getTranscript());
        shutdown();
        return;
      }

      if (input.toLowerCase() === 'history') {
        console.log('\n--- Meeting History ---');
        console.log(transcriptManager.getTranscript());
        console.log('------------------------\n');
        rl.prompt();
        return;
      }

      if (input) {
        process.stdout.write('Agent is thinking...\n');
        try {
          const response = await aiClient.query(input);
          console.log(`\Agent: ${response}\n`);
        } catch (err) {
          console.error(`\nError querying agent: ${err.message}\n`);
        }
      }
      rl.prompt();
    });

  } catch (err) {
    console.error('Failed to start application:', err.message);
    shutdown();
  }
}

function shutdown() {
  console.log('\nShutting down gracefully...');
  micCapture.stop();
  sysCapture.stop();
  micTranscription.disconnect();
  sysTranscription.disconnect();
  rl.close();
  process.exit(0);
}

// Handle signals
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Create meetings directory if it doesn't exist
if (!fs.existsSync('meetings')) {
  fs.mkdirSync('meetings');
}

startApp();
