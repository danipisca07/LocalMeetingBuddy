require('dotenv').config();
const readline = require('readline');
const { MeetingSession } = require('./src/meeting-session');
const fs = require('fs');

// Setup Readline for Terminal UI
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'MeetingTwin > '
});

console.log('--- MeetingTwin AI Assistant ---');
console.log('Initializing audio and transcription...');

// Create meetings directory if it doesn't exist
if (!fs.existsSync('meetings')) {
  fs.mkdirSync('meetings');
}

// Main Loop
async function startApp() {
  let session;
  try {
    // Create session with environment configuration
    session = new MeetingSession();

    // Handle transcription events from session
    session.on('transcription', (evt) => {
      console.log(`[${evt.source}]: ${evt.text}`);
      rl.prompt(true);
    });

    // Handle errors from session
    session.on('error', (err) => {
      console.error(`Device error: ${err.message}`);
    });

    // Start the session
    await session.start();

    rl.prompt();

    rl.on('line', async (line) => {
      const input = line.trim();

      if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
        await session.stop({ save: true });
        shutdown();
        return;
      }

      if (input.toLowerCase() === 'history') {
        console.log('\n--- Meeting History ---');
        console.log(session.getTranscript());
        console.log('------------------------\n');
        rl.prompt();
        return;
      }

      if (input) {
        process.stdout.write('Agent is thinking...\n');
        try {
          const response = await session.query(input);
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
  rl.close();
  process.exit(0);
}

// Handle signals
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

startApp();
