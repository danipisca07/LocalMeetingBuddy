require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const { exec } = require('child_process');
const { MeetingSession } = require('./src/meeting-session');
const { transcribeFile } = require('./src/batch-transcription');

const app = express();
const port = process.env.GUI_PORT || 3000;

// Meeting session state
let meetingSession = null;
let meetingState = 'idle'; // 'idle', 'starting', 'running', 'stopping', 'stopped', 'error'
let lastBroadcastState = 'idle';

// Batch job state (mutual exclusion with meeting)
let batchJob = null; // { jobId, state }

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// Create HTTP server
const server = http.createServer(app);

// Setup WebSocket server
const wss = new WebSocketServer({ server, path: '/ws' });

// Helper function to broadcast messages to all connected clients
function broadcastMessage(message) {
  wss.clients.forEach((client) => {
    if (client.readyState === require('ws').OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

// WebSocket connection handling
wss.on('connection', (ws) => {
  // Send current status to newly connected client
  ws.send(JSON.stringify({
    type: 'status',
    data: { state: meetingState }
  }));

  // Handle incoming messages from client
  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);

      // Dispatcher for commands
      switch (msg.command) {
        case 'startMeeting':
          await handleStartMeeting(ws);
          break;

        case 'stopMeeting':
          await handleStopMeeting(ws);
          break;

        case 'query':
          await handleQuery(ws, msg.text);
          break;

        case 'getTranscript':
          handleGetTranscript(ws);
          break;

        case 'startBatch':
          await handleStartBatch(ws, msg);
          break;

        default:
          ws.send(JSON.stringify({
            type: 'error',
            data: { message: `Unknown command: ${msg.command}` }
          }));
      }
    } catch (err) {
      // Parse error: send error back to sender only
      ws.send(JSON.stringify({
        type: 'error',
        data: { message: `Invalid JSON: ${err.message}` }
      }));
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });

  ws.on('close', () => {
    // Handle client disconnect if needed
  });
});

/**
 * Handle startMeeting command
 */
async function handleStartMeeting(ws) {
  // Check if a meeting is already running or batch job is active
  if (batchJob) {
    ws.send(JSON.stringify({
      type: 'error',
      data: { message: 'Operazione già in corso' }
    }));
    return;
  }

  if (meetingSession && meetingSession.isRunning) {
    ws.send(JSON.stringify({
      type: 'error',
      data: { message: 'Meeting già in corso' }
    }));
    return;
  }

  // Check for transition states (starting/stopping)
  if (meetingState === 'starting' || meetingState === 'stopping') {
    ws.send(JSON.stringify({
      type: 'error',
      data: { message: 'Operazione in corso, riprovare' }
    }));
    return;
  }

  // Update state
  meetingState = 'starting';
  lastBroadcastState = 'starting';
  broadcastMessage({ type: 'status', data: { state: 'starting' } });

  try {
    // Create new meeting session with config from environment
    meetingSession = new MeetingSession({
      transcriptionProvider: process.env.TRANSCRIPTION_PROVIDER,
      deepgramApiKey: process.env.DEEPGRAM_API_KEY,
      isLiveMeeting: process.env.IS_LIVE_MEETING === 'true',
      audioDeviceIdMic: process.env.AUDIO_DEVICE_ID_MIC,
      audioDeviceIdSystem: process.env.AUDIO_DEVICE_ID_SYSTEM,
      skipLlm: process.env.SKIP_LLM === 'true',
    });

    // Wire up events
    meetingSession.on('transcription', (evt) => {
      broadcastMessage({ type: 'transcription', data: evt });
    });

    meetingSession.on('status', (evt) => {
      meetingState = evt.state;
      lastBroadcastState = evt.state;
      broadcastMessage({ type: 'status', data: evt });
    });

    meetingSession.on('error', (err) => {
      console.error('MeetingSession error:', err);
      meetingState = 'error';
      lastBroadcastState = 'error';
      broadcastMessage({
        type: 'status',
        data: { state: 'error', message: err.message }
      });
      meetingSession = null;
    });

    // Start the session
    await meetingSession.start();
    meetingState = 'running';
    lastBroadcastState = 'running';
  } catch (err) {
    console.error('Failed to start meeting:', err);
    meetingState = 'error';
    lastBroadcastState = 'error';
    broadcastMessage({
      type: 'status',
      data: { state: 'error', message: err.message }
    });
    meetingSession = null;
  }
}

/**
 * Handle stopMeeting command
 */
async function handleStopMeeting(ws) {
  if (!meetingSession || !meetingSession.isRunning) {
    ws.send(JSON.stringify({
      type: 'error',
      data: { message: 'Nessun meeting in corso' }
    }));
    return;
  }

  // Check for transition states
  if (meetingState === 'starting' || meetingState === 'stopping') {
    ws.send(JSON.stringify({
      type: 'error',
      data: { message: 'Operazione in corso, riprovare' }
    }));
    return;
  }

  meetingState = 'stopping';
  lastBroadcastState = 'stopping';
  broadcastMessage({
    type: 'status',
    data: { state: 'stopping', message: 'Salvataggio in corso…' }
  });

  try {
    await meetingSession.stop({ save: true });

    // Include saved file paths in the final status message
    let message = 'Meeting salvato';
    if (meetingSession.lastSavePrefix) {
      const prefix = meetingSession.lastSavePrefix;
      message += ` in meetings/${prefix}-meeting-*`;
    }

    meetingState = 'stopped';
    lastBroadcastState = 'stopped';
    // The session.stop() already emits status event, so status should be broadcast already
    // But ensure it's sent with any additional info
    meetingSession = null;
  } catch (err) {
    console.error('Failed to stop meeting:', err);
    meetingState = 'error';
    lastBroadcastState = 'error';
    broadcastMessage({
      type: 'status',
      data: { state: 'error', message: `Errore durante il salvataggio: ${err.message}` }
    });
    meetingSession = null;
  }
}

/**
 * Handle query command
 */
async function handleQuery(ws, queryText) {
  if (!meetingSession || !meetingSession.isRunning) {
    ws.send(JSON.stringify({
      type: 'ai-error',
      data: { message: 'Nessun meeting in corso' }
    }));
    return;
  }

  try {
    const response = await meetingSession.query(queryText);
    broadcastMessage({
      type: 'ai-response',
      data: { text: response }
    });
  } catch (err) {
    console.error('Query error:', err);
    broadcastMessage({
      type: 'ai-error',
      data: { message: err.message }
    });
  }
}

/**
 * Handle getTranscript command
 */
function handleGetTranscript(ws) {
  const transcript = meetingSession ? meetingSession.getTranscript() : '';
  ws.send(JSON.stringify({
    type: 'transcript',
    data: { text: transcript }
  }));
}

/**
 * Handle startBatch command
 */
async function handleStartBatch(ws, msg) {
  // Check if a batch job is already running or meeting is live
  if (batchJob) {
    ws.send(JSON.stringify({
      type: 'error',
      data: { message: 'Operazione già in corso' }
    }));
    return;
  }

  if (meetingSession && meetingSession.isRunning) {
    ws.send(JSON.stringify({
      type: 'error',
      data: { message: 'Operazione già in corso' }
    }));
    return;
  }

  const { filePath, provider, track, skipLlm } = msg;

  // Validate filePath
  if (!filePath || typeof filePath !== 'string') {
    ws.send(JSON.stringify({
      type: 'error',
      data: { message: 'filePath richiesto' }
    }));
    return;
  }

  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    ws.send(JSON.stringify({
      type: 'error',
      data: { message: `File non trovato: ${resolvedPath}` }
    }));
    return;
  }

  // Start batch job
  const jobId = Date.now().toString(36);
  batchJob = { jobId, state: 'starting' };

  // Fire transcription without blocking
  transcribeFile(resolvedPath, {
    provider,
    track: track !== null ? track : null,
    skipLlm: skipLlm === true,
    outDir: 'meetings',
    onEvent: (evt) => {
      // Broadcast batch progress to all clients
      broadcastMessage({
        type: 'batch-progress',
        data: { jobId, ...evt }
      });
    },
  }).then(() => {
    // Success: job complete
    batchJob = null;
  }).catch((err) => {
    // Error: broadcast error state
    broadcastMessage({
      type: 'batch-progress',
      data: { jobId, state: 'error', message: err.message }
    });
    batchJob = null;
  });
}

// Create meetings directory if it doesn't exist
if (!fs.existsSync('meetings')) {
  fs.mkdirSync('meetings');
}

// Start server
server.listen(port, () => {
  const url = `http://localhost:${port}`;
  console.log(`MeetingTwin GUI listening on ${url}`);

  // Attempt to open browser (best-effort)
  const platform = process.platform;
  let command;

  if (platform === 'win32') {
    command = `start "" "${url}"`;
  } else if (platform === 'darwin') {
    command = `open "${url}"`;
  } else {
    command = `xdg-open "${url}"`;
  }

  exec(command, (err) => {
    if (err) {
      // Silently ignore browser open errors; user can open manually
    }
  });
});

// Graceful shutdown
function shutdown() {
  console.log('\nShutting down server...');
  wss.clients.forEach((client) => {
    client.close();
  });
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
