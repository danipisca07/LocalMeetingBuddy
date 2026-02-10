require('dotenv').config();
const readline = require('readline');
const { DeviceManager } = require('./device-manager');
const TranscriptManager = require('./transcript-manager');
const ClaudeClient = require('./claude-client');
const GroqClient = require('./groq-client');
const { determineDisplaySource } = require('./utils');
const fs = require('fs');

// Configuration
const SAMPLE_RATE = 16000;
const CONFIDENCE_THRESHOLD = 0.85; // requirement: > 0.85
const deepgramApiKey = process.env.DEEPGRAM_API_KEY;
const isLiveMeeting = process.env.IS_LIVE_MEETING === 'true';

if (!deepgramApiKey) {
  console.error('Error: DEEPGRAM_API_KEY must be set in .env');
  process.exit(1);
}

// Initialize Device Manager
const deviceManager = new DeviceManager();

// Add Microphone Device
deviceManager.addDevice('mic', {
    deviceId: process.env.AUDIO_DEVICE_ID_MIC,
    label: isLiveMeeting ? 'live' : 'user',
    apiKey: deepgramApiKey,
    sampleRate: SAMPLE_RATE
});

// Add System Audio Device
deviceManager.addDevice('sys', {
    deviceId: process.env.AUDIO_DEVICE_ID_SYSTEM,
    label: 'caller',
    apiKey: deepgramApiKey,
    sampleRate: SAMPLE_RATE
});

const transcriptManager = new TranscriptManager();

var aiClient
if(process.env.GROQ_API_KEY) {
  aiClient = new GroqClient(transcriptManager);
} else if(process.env.ANTHROPIC_API_KEY) {
  aiClient = new ClaudeClient(transcriptManager);
} else {
  console.error('Error: GROQ_API_KEY or ANTHROPIC_API_KEY must be set in .env');
  process.exit(1);
}

// Setup Readline for Terminal UI
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'MeetingTwin > '
});

console.log('--- MeetingTwin AI Assistant ---');
console.log('Initializing audio and transcription...');

// Handle Transcription Events
deviceManager.on('transcription', (evt) => {
    if (evt.confidence === undefined || evt.confidence >= CONFIDENCE_THRESHOLD) {
        // Determine source display name
        const displaySource = determineDisplaySource(isLiveMeeting, evt.source, evt.speaker);
        
        console.log(`[${displaySource}]: ${evt.text}`);
        transcriptManager.addTranscriptEntry(evt.timestamp, displaySource, evt.text, evt.confidence);
        rl.prompt(true);
    }
});

// Handle Device Connection Events (Optional logging)
deviceManager.on('deviceConnected', (id) => {
    // console.log(`Device connected: ${id}`);
});

deviceManager.on('deviceDisconnected', (id) => {
    // console.log(`Device disconnected: ${id}`);
});

// Main Loop
async function startApp() {
  try {
    await deviceManager.startAll();
    
    rl.prompt();

    rl.on('line', async (line) => {
      const input = line.trim();
      
      if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
        try {
          // save transcript to file
          fs.writeFileSync(`meetings/${(new Date()).toISOString().slice(0, 16).replace(':', '')}-meeting-transcript.txt`, transcriptManager.getTranscript());
        } catch (err) {
          console.error(`\nError saving transcript: ${err.message}\n`);
        }
        
        if(process.env.SKIP_LLM !== 'true') {
          try {
            const recap = await aiClient.query('Crea un recap del meeting in italiano. Formatta l\'output in Markdown.');
            console.log(`\nMeeting Recap: ${recap}\n`);
            fs.writeFileSync(`meetings/${(new Date()).toISOString().slice(0, 16).replace(':', '')}-meeting-recap.md`, recap);
          } catch (err) {
            console.error(`\nError generating meeting recap: ${err.message}\n`);
          }
        }

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
  deviceManager.stopAll();
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
