/**
 * MeetingTwin Frontend Application
 * Vanilla JavaScript with WebSocket client and message handler registry
 */

// WebSocket connection management
class WebSocketClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = Infinity;
    this.reconnectDelay = 1000; // 1 second
    this.handlers = {};

    this.connect();
  }

  connect() {
    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.reconnectAttempts = 0;
        this.updateConnectionStatus(true);
        // Request current transcript on reconnect
        this.send({ command: 'getTranscript' });
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      this.ws.onerror = (err) => {
        console.error('WebSocket error:', err);
      };

      this.ws.onclose = () => {
        console.log('WebSocket disconnected');
        this.updateConnectionStatus(false);
        this.attemptReconnect();
      };
    } catch (err) {
      console.error('Failed to create WebSocket:', err);
      this.updateConnectionStatus(false);
      this.attemptReconnect();
    }
  }

  attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`Reconnecting in ${this.reconnectDelay}ms (attempt ${this.reconnectAttempts})`);
      setTimeout(() => this.connect(), this.reconnectDelay);
    }
  }

  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket not connected, message not sent:', message);
    }
  }

  handleMessage(message) {
    const { type, data } = message;

    if (this.handlers[type]) {
      try {
        this.handlers[type](data);
      } catch (err) {
        console.error(`Error in handler for message type '${type}':`, err);
      }
    } else {
      console.log(`No handler registered for message type: ${type}`);
    }
  }

  registerHandler(type, callback) {
    this.handlers[type] = callback;
  }

  updateConnectionStatus(connected) {
    const statusElement = document.getElementById('connection-status');
    if (statusElement) {
      if (connected) {
        statusElement.classList.remove('disconnected');
        statusElement.classList.add('connected');
        statusElement.querySelector('.indicator-text').textContent = 'Connesso';
      } else {
        statusElement.classList.remove('connected');
        statusElement.classList.add('disconnected');
        statusElement.querySelector('.indicator-text').textContent = 'Disconnesso';
      }
    }
  }
}

// Initialize WebSocket client
const wsUrl = `ws://${window.location.host}/ws`;
const wsClient = new WebSocketClient(wsUrl);

// Live Meeting State
let currentMeetingState = 'idle';
let isAwaitingAiResponse = false;

/**
 * Update meeting status UI
 */
function updateMeetingStatus(state, message) {
  currentMeetingState = state;

  const badge = document.getElementById('meeting-status-badge');
  const statusText = document.getElementById('status-text');
  const statusMessage = document.getElementById('status-message');
  const btnStart = document.getElementById('btn-start-meeting');
  const btnStop = document.getElementById('btn-stop-meeting');
  const chatInput = document.getElementById('chat-input');
  const btnSend = document.getElementById('btn-send-chat');

  // Update badge state
  badge.className = `status-badge ${state}`;

  // Map state to display text
  const stateNames = {
    'idle': 'Inattivo',
    'starting': 'Avviamento…',
    'running': 'In corso',
    'stopping': 'Arresto…',
    'stopped': 'Interrotto',
    'error': 'Errore'
  };

  statusText.textContent = stateNames[state] || state;
  statusMessage.textContent = message || '';

  // Update button states
  const isTransitioning = state === 'starting' || state === 'stopping';
  const isIdle = state === 'idle' || state === 'stopped' || state === 'error';
  const isRunning = state === 'running';

  btnStart.disabled = !isIdle || isTransitioning;
  btnStop.disabled = !isRunning || isTransitioning;

  // Update chat input state
  chatInput.disabled = !isRunning;
  btnSend.disabled = !isRunning || isAwaitingAiResponse;
}

/**
 * Append a transcription entry to the transcript display
 */
function appendTranscriptionEntry(source, text) {
  const display = document.getElementById('transcript-display');

  // Create and append text node
  const entry = document.createElement('div');
  entry.className = 'transcript-entry';

  const label = document.createElement('span');
  label.className = 'source-label';
  label.textContent = `[${source}]:`;

  entry.appendChild(label);
  entry.appendChild(document.createTextNode(` ${text}`));

  display.appendChild(entry);

  // Auto-scroll to bottom
  display.scrollTop = display.scrollHeight;
}

/**
 * Repopulate transcript from a full transcript text
 */
function populateTranscript(fullTranscript) {
  const display = document.getElementById('transcript-display');
  display.innerHTML = ''; // Clear existing

  if (!fullTranscript) return;

  // Parse transcript lines and rebuild display
  const lines = fullTranscript.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    // Expected format: "[source]: text"
    const match = line.match(/^\[([^\]]+)\]:\s*(.*)/);
    if (match) {
      const source = match[1];
      const text = match[2];
      appendTranscriptionEntry(source, text);
    }
  }

  // Auto-scroll to bottom
  display.scrollTop = display.scrollHeight;
}

/**
 * Append a chat message
 */
function appendChatMessage(role, text) {
  const display = document.getElementById('chat-display');

  const msg = document.createElement('div');
  msg.className = `chat-message ${role}`;

  const label = document.createElement('div');
  label.className = 'message-label';
  label.textContent = role === 'user' ? 'Tu:' : 'Agent:';

  msg.appendChild(label);
  msg.appendChild(document.createTextNode(text));

  display.appendChild(msg);

  // Auto-scroll to bottom
  display.scrollTop = display.scrollHeight;
}

/**
 * Append an error message in chat
 */
function appendChatError(text) {
  const display = document.getElementById('chat-display');

  const msg = document.createElement('div');
  msg.className = 'chat-message error';
  msg.textContent = `Errore: ${text}`;

  display.appendChild(msg);

  // Auto-scroll to bottom
  display.scrollTop = display.scrollHeight;
}

// Register message handlers for Phase 1
wsClient.registerHandler('transcription', (data) => {
  console.log('Transcription received:', data);
  appendTranscriptionEntry(data.source, data.text);
});

wsClient.registerHandler('status', (data) => {
  console.log('Status update:', data);
  updateMeetingStatus(data.state, data.message);
});

wsClient.registerHandler('transcript', (data) => {
  console.log('Transcript received:', data);
  populateTranscript(data.text);
});

wsClient.registerHandler('ai-response', (data) => {
  console.log('AI response:', data);
  document.getElementById('chat-thinking').style.display = 'none';
  isAwaitingAiResponse = false;
  appendChatMessage('agent', data.text);
  updateButtonState();
});

wsClient.registerHandler('ai-error', (data) => {
  console.error('AI error:', data);
  document.getElementById('chat-thinking').style.display = 'none';
  isAwaitingAiResponse = false;
  appendChatError(data.message);
  updateButtonState();
});

// Batch transcription state
let batchInProgress = false;
let currentBatchJobId = null;

/**
 * Append a batch progress line to the log
 */
function appendBatchProgressLine(text, type = 'info') {
  const logDisplay = document.getElementById('batch-log');
  if (!logDisplay) return;

  const line = document.createElement('div');
  line.className = `batch-log-line ${type}`;
  line.textContent = text;

  logDisplay.appendChild(line);

  // Auto-scroll to bottom
  logDisplay.scrollTop = logDisplay.scrollHeight;
}

/**
 * Clear batch progress log
 */
function clearBatchLog() {
  const logDisplay = document.getElementById('batch-log');
  if (!logDisplay) return;
  logDisplay.innerHTML = '';
}

wsClient.registerHandler('batch-progress', (data) => {
  console.log('Batch progress:', data);
  currentBatchJobId = data.jobId;

  switch (data.state) {
    case 'probing':
      appendBatchProgressLine('Analisi file…');
      batchInProgress = true;
      break;
    case 'decoding':
      appendBatchProgressLine(`Decodifica traccia ${data.track}/${data.totalTracks}…`);
      break;
    case 'transcribing':
      appendBatchProgressLine(`Trascrizione traccia ${data.track} (${data.durationSec}s di audio)…`);
      break;
    case 'transcription':
      appendBatchProgressLine(`[${data.label}]: ${data.text}`);
      break;
    case 'transcription-error':
      appendBatchProgressLine(`Errore traccia ${data.track}: ${data.message}`, 'error');
      break;
    case 'track-done':
      appendBatchProgressLine(`✔ Traccia ${data.track} completata`);
      break;
    case 'saving':
      appendBatchProgressLine('Salvataggio in corso…');
      break;
    case 'done':
      appendBatchProgressLine(`✔ Completato → ${data.outputs.transcriptPath}`);
      if (data.outputs.recapPath) {
        appendBatchProgressLine(`✔ Recap → ${data.outputs.recapPath}`);
      }
      batchInProgress = false;
      updateBatchButtonState();
      break;
    case 'error':
      appendBatchProgressLine(`Errore: ${data.message}`, 'error');
      batchInProgress = false;
      updateBatchButtonState();
      break;
  }
});

wsClient.registerHandler('error', (data) => {
  console.error('Server error:', data);
  appendBatchProgressLine(`Errore: ${data.message}`, 'error');
});

/**
 * Update button state based on current conditions
 */
function updateButtonState() {
  const btnSend = document.getElementById('btn-send-chat');
  const isRunning = currentMeetingState === 'running';
  btnSend.disabled = !isRunning || isAwaitingAiResponse;
}

/**
 * Handle start meeting button click
 */
function handleStartMeeting() {
  wsClient.send({ command: 'startMeeting' });
}

/**
 * Handle stop meeting button click
 */
function handleStopMeeting() {
  wsClient.send({ command: 'stopMeeting' });
}

/**
 * Handle chat send button click
 */
function handleSendChat() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();

  if (!text) return;

  appendChatMessage('user', text);
  input.value = '';

  isAwaitingAiResponse = true;
  updateButtonState();
  document.getElementById('chat-thinking').style.display = 'block';

  wsClient.send({ command: 'query', text });
}

/**
 * Handle Enter key in chat input
 */
function handleChatInputKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    handleSendChat();
  }
}

// Tab management
function initializeTabs() {
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabPanes = document.querySelectorAll('.tab-pane');

  tabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const tabId = button.getAttribute('data-tab');

      // Deactivate all tabs
      tabButtons.forEach((btn) => btn.classList.remove('active'));
      tabPanes.forEach((pane) => pane.classList.remove('active'));

      // Activate selected tab
      button.classList.add('active');
      const selectedPane = document.getElementById(tabId);
      if (selectedPane) {
        selectedPane.classList.add('active');
      }
    });
  });
}

/**
 * Update batch button state based on current conditions
 */
function updateBatchButtonState() {
  const btnTranscribe = document.getElementById('btn-start-batch');
  if (btnTranscribe) {
    btnTranscribe.disabled = batchInProgress;
  }
}

/**
 * Handle batch transcription start button click
 */
function handleStartBatch() {
  const fileInput = document.getElementById('batch-file-path');
  const providerSelect = document.getElementById('batch-provider');
  const trackInput = document.getElementById('batch-track');
  const skipLlmCheckbox = document.getElementById('batch-skip-llm');

  const filePath = fileInput ? fileInput.value.trim() : '';
  if (!filePath) {
    alert('Inserire il percorso del file');
    return;
  }

  const provider = providerSelect ? providerSelect.value : null;
  const track = trackInput && trackInput.value ? parseInt(trackInput.value, 10) : null;
  const skipLlm = skipLlmCheckbox ? skipLlmCheckbox.checked : false;

  // Clear log and start
  clearBatchLog();
  wsClient.send({
    command: 'startBatch',
    filePath,
    provider: provider === 'default' ? null : provider,
    track,
    skipLlm,
  });
}

/**
 * Initialize Phase 1: Live Meeting
 */
function initializeLiveMeeting() {
  const btnStart = document.getElementById('btn-start-meeting');
  const btnStop = document.getElementById('btn-stop-meeting');
  const btnSend = document.getElementById('btn-send-chat');
  const chatInput = document.getElementById('chat-input');

  if (btnStart) {
    btnStart.addEventListener('click', handleStartMeeting);
  }

  if (btnStop) {
    btnStop.addEventListener('click', handleStopMeeting);
  }

  if (btnSend) {
    btnSend.addEventListener('click', handleSendChat);
  }

  if (chatInput) {
    chatInput.addEventListener('keydown', handleChatInputKeydown);
  }
}

/**
 * Initialize Phase 2: Batch Transcription
 */
function initializeBatchTranscription() {
  const btnTranscribe = document.getElementById('btn-start-batch');
  if (btnTranscribe) {
    btnTranscribe.addEventListener('click', handleStartBatch);
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  initializeTabs();
  initializeLiveMeeting();
  initializeBatchTranscription();

  // On connection, request current transcript
  setTimeout(() => {
    wsClient.send({ command: 'getTranscript' });
  }, 500);

  console.log('MeetingTwin frontend initialized');
});
