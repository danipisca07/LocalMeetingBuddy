require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const { exec } = require('child_process');
const { MeetingSession } = require('./src/meeting-session');
const { transcribeFile } = require('./src/batch-transcription');
const { ConfigManager } = require('./src/config-manager');
const { listMeetings, getMeeting } = require('./src/meeting-history');

const app = express();
const port = process.env.GUI_PORT || 3000;

// Configuration manager (per-session, in-memory)
const configManager = new ConfigManager();

// Meeting session state
let meetingSession = null;
let meetingState = 'idle'; // 'idle', 'starting', 'running', 'stopping', 'stopped', 'error'
let lastBroadcastState = 'idle';

// Batch job state (mutual exclusion with meeting)
let batchJob = null; // { jobId, state }

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Helper: detect if device name suggests it's a loopback/stereo mix device
 * Based on naming patterns from scripts/check-audio.js
 */
function isLoopbackDevice(deviceName) {
  const name = deviceName.toLowerCase();
  return (
    name.includes('loopback') ||
    name.includes('stereo mix') ||
    name.includes('virtual') ||
    name.includes('vb-audio')
  );
}

// Routes
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

/**
 * GET /api/devices
 * List available audio input devices with loopback detection
 */
app.get('/api/devices', (req, res) => {
  try {
    const naudiodon = require('naudiodon');
    const devices = naudiodon.getDevices();

    // Filter for input devices and add loopback detection
    const inputDevices = devices
      .filter(device => device.maxInputChannels > 0)
      .map(device => ({
        id: device.id,
        name: device.name,
        maxInputChannels: device.maxInputChannels,
        defaultSampleRate: device.defaultSampleRate,
        isLoopbackCandidate: isLoopbackDevice(device.name),
      }));

    res.json(inputDevices);
  } catch (err) {
    console.error('Failed to get devices:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/config
 * Get current configuration (in-memory)
 */
app.get('/api/config', (req, res) => {
  const config = configManager.get();
  res.json(config);
});

/**
 * POST /api/config
 * Update configuration
 * Returns 409 if meeting or batch job is active
 * Returns 400 if validation fails
 */
app.post('/api/config', (req, res) => {
  // Check if meeting or batch job is active
  if (meetingSession && meetingSession.isRunning) {
    return res.status(409).json({
      error: 'Cannot change configuration during a meeting or transcription',
    });
  }

  if (batchJob) {
    return res.status(409).json({
      error: 'Cannot change configuration during a meeting or transcription',
    });
  }

  try {
    const updated = configManager.update(req.body);
    configManager.applyToEnv();
    res.json({ ok: true, config: updated });
  } catch (err) {
    console.error('Config update error:', err);
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/meetings
 * List all saved meetings
 */
app.get('/api/meetings', async (req, res) => {
  try {
    const meetings = await listMeetings('meetings');
    res.json(meetings);
  } catch (err) {
    console.error('Failed to list meetings:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/meetings/:prefix
 * Get transcript and recap for a specific meeting
 */
app.get('/api/meetings/:prefix', async (req, res) => {
  try {
    const meeting = await getMeeting(req.params.prefix, 'meetings');
    res.json(meeting);
  } catch (err) {
    console.error('Failed to get meeting:', err);
    // Return 404 for not found, 400 for invalid prefix
    const statusCode = err.message.includes('Invalid prefix') ? 400 : 404;
    res.status(statusCode).json({ error: 'Meeting not found' });
  }
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
      data: { message: 'Operation already in progress' }
    }));
    return;
  }

  if (meetingSession && meetingSession.isRunning) {
    ws.send(JSON.stringify({
      type: 'error',
      data: { message: 'Meeting already in progress' }
    }));
    return;
  }

  // Check for transition states (starting/stopping)
  if (meetingState === 'starting' || meetingState === 'stopping') {
    ws.send(JSON.stringify({
      type: 'error',
      data: { message: 'Operation in progress, retry' }
    }));
    return;
  }

  // Update state
  meetingState = 'starting';
  lastBroadcastState = 'starting';
  broadcastMessage({ type: 'status', data: { state: 'starting' } });

  try {
    // Apply current config to environment before creating session
    configManager.applyToEnv();
    const config = configManager.get();

    // Create new meeting session with config from configManager
    meetingSession = new MeetingSession({
      transcriptionProvider: config.transcriptionProvider,
      deepgramApiKey: process.env.DEEPGRAM_API_KEY, // API key stays in env
      isLiveMeeting: config.isLiveMeeting,
      audioDeviceIdMic: config.audioDeviceIdMic,
      audioDeviceIdSystem: config.audioDeviceIdSystem,
      skipLlm: config.skipLlm,
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
      data: { message: 'No meeting in progress' }
    }));
    return;
  }

  // Check for transition states
  if (meetingState === 'starting' || meetingState === 'stopping') {
    ws.send(JSON.stringify({
      type: 'error',
      data: { message: 'Operation in progress, retry' }
    }));
    return;
  }

  meetingState = 'stopping';
  lastBroadcastState = 'stopping';
  broadcastMessage({
    type: 'status',
    data: { state: 'stopping', message: 'Saving…' }
  });

  try {
    await meetingSession.stop({ save: true });

    // Include saved file paths in the final status message
    let message = 'Meeting saved';
    if (meetingSession.lastSavePrefix) {
      const prefix = meetingSession.lastSavePrefix;
      message += ` to meetings/${prefix}-meeting-*`;
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
      data: { state: 'error', message: `Error while saving: ${err.message}` }
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
      data: { message: 'No meeting in progress' }
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
      data: { message: 'Operation already in progress' }
    }));
    return;
  }

  if (meetingSession && meetingSession.isRunning) {
    ws.send(JSON.stringify({
      type: 'error',
      data: { message: 'Operation already in progress' }
    }));
    return;
  }

  const { filePath, provider, track, skipLlm } = msg;

  // Validate filePath
  if (!filePath || typeof filePath !== 'string') {
    ws.send(JSON.stringify({
      type: 'error',
      data: { message: 'filePath required' }
    }));
    return;
  }

  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    ws.send(JSON.stringify({
      type: 'error',
      data: { message: `File not found: ${resolvedPath}` }
    }));
    return;
  }

  // Start batch job
  const jobId = Date.now().toString(36);
  batchJob = { jobId, state: 'starting' };

  // Apply current config to environment before transcribing
  configManager.applyToEnv();

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
