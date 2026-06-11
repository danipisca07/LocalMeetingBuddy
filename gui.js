require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const { exec } = require('child_process');

const app = express();
const port = process.env.GUI_PORT || 3000;

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

// WebSocket helper to broadcast to all connected clients
function broadcast(message) {
  wss.clients.forEach((client) => {
    if (client.readyState === require('ws').OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

// WebSocket connection handling
wss.on('connection', (ws) => {
  // Handle incoming messages from client
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);

      // Dispatcher for commands
      switch (msg.command) {
        case 'startMeeting':
          // Placeholder: will be implemented in phase 1
          ws.send(JSON.stringify({
            type: 'error',
            data: { message: 'startMeeting not yet implemented' }
          }));
          break;

        case 'stopMeeting':
          // Placeholder: will be implemented in phase 1
          ws.send(JSON.stringify({
            type: 'error',
            data: { message: 'stopMeeting not yet implemented' }
          }));
          break;

        case 'query':
          // Placeholder: will be implemented in phase 1
          ws.send(JSON.stringify({
            type: 'error',
            data: { message: 'query not yet implemented' }
          }));
          break;

        case 'getTranscript':
          // Placeholder: will be implemented in phase 1
          ws.send(JSON.stringify({
            type: 'error',
            data: { message: 'getTranscript not yet implemented' }
          }));
          break;

        case 'startBatch':
          // Placeholder: will be implemented in phase 2
          ws.send(JSON.stringify({
            type: 'error',
            data: { message: 'startBatch not yet implemented' }
          }));
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
