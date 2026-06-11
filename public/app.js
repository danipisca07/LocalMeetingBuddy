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
      const textEl = statusElement.querySelector('.indicator-text');
      const key = connected ? 'connection.connected' : 'connection.disconnected';
      if (connected) {
        statusElement.classList.remove('disconnected');
        statusElement.classList.add('connected');
      } else {
        statusElement.classList.remove('connected');
        statusElement.classList.add('disconnected');
      }
      // Keep the data-i18n key in sync so a language switch re-translates correctly
      textEl.setAttribute('data-i18n', key);
      textEl.textContent = i18n.t(key);
    }
  }
}

// Initialize WebSocket client
const wsUrl = `ws://${window.location.host}/ws`;
const wsClient = new WebSocketClient(wsUrl);

// Live Meeting State
let currentMeetingState = 'idle';
let lastStatusMessage = '';
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

  // Remember last message so we can re-render on a language switch
  lastStatusMessage = message || '';

  // Map state to display text via i18n (falls back to the raw state)
  const translated = i18n.t(`status.${state}`);
  statusText.textContent = translated === `status.${state}` ? state : translated;
  statusMessage.textContent = lastStatusMessage;

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
  label.textContent = role === 'user' ? i18n.t('chat.you') : i18n.t('chat.agent');

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
  msg.textContent = `${i18n.t('chat.errorPrefix')} ${text}`;

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

  return line;
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
      appendBatchProgressLine(i18n.t('batch.probing'));
      batchInProgress = true;
      break;
    case 'decoding':
      appendBatchProgressLine(i18n.t('batch.decoding', { track: data.track, total: data.totalTracks }));
      break;
    case 'transcribing':
      appendBatchProgressLine(i18n.t('batch.transcribing', { track: data.track, sec: data.durationSec }));
      break;
    case 'transcription':
      appendBatchProgressLine(`[${data.label}]: ${data.text}`);
      break;
    case 'transcription-error':
      appendBatchProgressLine(i18n.t('batch.transcriptionError', { track: data.track, message: data.message }), 'error');
      break;
    case 'track-done':
      appendBatchProgressLine(i18n.t('batch.trackDone', { track: data.track }));
      break;
    case 'saving':
      appendBatchProgressLine(i18n.t('batch.saving'));
      break;
    case 'done':
      appendBatchProgressLine(i18n.t('batch.done', { path: data.outputs.transcriptPath }));
      if (data.outputs.recapPath) {
        appendBatchProgressLine(i18n.t('batch.recap', { path: data.outputs.recapPath }));
      }
      batchInProgress = false;
      updateBatchButtonState();
      break;
    case 'error':
      appendBatchProgressLine(i18n.t('batch.error', { message: data.message }), 'error');
      batchInProgress = false;
      updateBatchButtonState();
      break;
  }
});

wsClient.registerHandler('error', (data) => {
  console.error('Server error:', data);
  appendBatchProgressLine(i18n.t('batch.error', { message: data.message }), 'error');
  batchInProgress = false;
  updateBatchButtonState();
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

// File selected via drag & drop or file picker (File object)
let selectedBatchFile = null;

/**
 * Set or clear the file selected for batch transcription, updating the dropzone UI
 */
function setSelectedBatchFile(file) {
  selectedBatchFile = file || null;

  const idleView = document.getElementById('batch-dropzone-idle');
  const selectedView = document.getElementById('batch-dropzone-selected');
  const fileNameLabel = document.getElementById('batch-file-name');

  if (idleView) idleView.classList.toggle('hidden', !!selectedBatchFile);
  if (selectedView) selectedView.classList.toggle('hidden', !selectedBatchFile);
  if (fileNameLabel) {
    fileNameLabel.textContent = selectedBatchFile
      ? `${selectedBatchFile.name} (${formatFileSize(selectedBatchFile.size)})`
      : '';
  }
}

/**
 * Format a byte count for display (e.g. "12.3 MB")
 */
function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 'B';
  for (const u of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = u;
  }
  return `${value.toFixed(1)} ${unit}`;
}

/**
 * Upload the selected file to the server, reporting progress (0-100).
 * Resolves with the server-side path to pass to startBatch.
 */
function uploadBatchFile(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name));

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && body.path) {
          resolve(body.path);
        } else {
          reject(new Error(body.error || `HTTP ${xhr.status}`));
        }
      } catch (err) {
        reject(new Error(`HTTP ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(file);
  });
}

/**
 * Handle batch transcription start button click:
 * upload the selected file, then start the transcription job
 */
async function handleStartBatch() {
  const providerSelect = document.getElementById('batch-provider');
  const trackInput = document.getElementById('batch-track');
  const skipLlmCheckbox = document.getElementById('batch-skip-llm');

  if (!selectedBatchFile) {
    alert(i18n.t('batch.noFile'));
    return;
  }

  const provider = providerSelect ? providerSelect.value : null;
  const track = trackInput && trackInput.value ? parseInt(trackInput.value, 10) : null;
  const skipLlm = skipLlmCheckbox ? skipLlmCheckbox.checked : false;

  // Clear log and upload the file first
  clearBatchLog();
  batchInProgress = true;
  updateBatchButtonState();

  const progressLine = appendBatchProgressLine(i18n.t('batch.uploading', { pct: 0 }));

  let filePath;
  try {
    filePath = await uploadBatchFile(selectedBatchFile, (pct) => {
      if (progressLine) {
        progressLine.textContent = i18n.t('batch.uploading', { pct });
      }
    });
  } catch (err) {
    appendBatchProgressLine(i18n.t('batch.uploadError', { message: err.message }), 'error');
    batchInProgress = false;
    updateBatchButtonState();
    return;
  }

  if (progressLine) {
    progressLine.textContent = i18n.t('batch.uploaded');
  }

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

  const dropzone = document.getElementById('batch-dropzone');
  const fileInput = document.getElementById('batch-file-input');
  const btnBrowse = document.getElementById('btn-browse-file');
  const btnClear = document.getElementById('btn-clear-file');

  if (fileInput) {
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length > 0) {
        setSelectedBatchFile(fileInput.files[0]);
      }
    });
  }

  if (btnBrowse && fileInput) {
    btnBrowse.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.click();
    });
  }

  if (btnClear && fileInput) {
    btnClear.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.value = '';
      setSelectedBatchFile(null);
    });
  }

  if (dropzone && fileInput) {
    // Clicking anywhere on the empty dropzone opens the file picker
    dropzone.addEventListener('click', () => {
      if (!selectedBatchFile) {
        fileInput.click();
      }
    });

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        setSelectedBatchFile(e.dataTransfer.files[0]);
      }
    });
  }
}

// Configuration state
let currentConfig = {};
let availableDevices = [];

/**
 * Load and populate configuration UI
 */
async function loadConfiguration() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) {
      console.error('Failed to load config:', response.statusText);
      return;
    }

    currentConfig = await response.json();
    populateConfigForm();
  } catch (err) {
    console.error('Error loading configuration:', err);
  }
}

/**
 * Load and populate available devices
 */
async function loadDevices() {
  try {
    const response = await fetch('/api/devices');
    if (!response.ok) {
      console.error('Failed to load devices:', response.statusText);
      return;
    }

    availableDevices = await response.json();
    populateDeviceSelects();
  } catch (err) {
    console.error('Error loading devices:', err);
  }
}

/**
 * Populate device select dropdowns
 */
function populateDeviceSelects() {
  const micSelect = document.getElementById('config-device-mic');
  const systemSelect = document.getElementById('config-device-system');

  if (!micSelect || !systemSelect) return;

  // Clear existing options (except the first "— da .env —" option)
  while (micSelect.options.length > 1) {
    micSelect.remove(1);
  }
  while (systemSelect.options.length > 1) {
    systemSelect.remove(1);
  }

  // Add device options
  for (const device of availableDevices) {
    const micOption = document.createElement('option');
    micOption.value = device.id.toString();
    micOption.textContent = `(${device.id}) ${device.name}`;
    micSelect.appendChild(micOption);

    const systemOption = document.createElement('option');
    systemOption.value = device.id.toString();
    systemOption.textContent = `(${device.id}) ${device.name}`;
    if (device.isLoopbackCandidate) {
      systemOption.textContent += ' ★';
    }
    systemSelect.appendChild(systemOption);
  }

  // Set current values
  if (currentConfig.audioDeviceIdMic) {
    micSelect.value = currentConfig.audioDeviceIdMic;
  }
  if (currentConfig.audioDeviceIdSystem) {
    systemSelect.value = currentConfig.audioDeviceIdSystem;
  }

  // Show loopback hint if current system device is a loopback candidate
  const systemOptionSelected = systemSelect.selectedOptions[0];
  const loopbackHint = document.querySelector('.loopback-hint');
  if (loopbackHint && systemOptionSelected && systemOptionSelected.textContent.includes('★')) {
    loopbackHint.style.display = 'inline';
  } else if (loopbackHint) {
    loopbackHint.style.display = 'none';
  }
}

/**
 * Populate configuration form with current values
 */
function populateConfigForm() {
  // Provider
  const providerSelect = document.getElementById('config-provider');
  if (providerSelect) {
    providerSelect.value = currentConfig.transcriptionProvider || 'deepgram';
  }

  // Languages
  const deepgramLanguageInput = document.getElementById('config-deepgram-language');
  if (deepgramLanguageInput) {
    deepgramLanguageInput.value = currentConfig.deepgramLanguage || 'en';
  }

  const localLanguageInput = document.getElementById('config-local-language');
  if (localLanguageInput) {
    localLanguageInput.value = currentConfig.localTranscriptionLanguage || 'en';
  }

  // Whisper model
  const whisperModelSelect = document.getElementById('config-whisper-model');
  if (whisperModelSelect) {
    whisperModelSelect.value = currentConfig.localWhisperModel || 'base';
  }

  // Checkboxes
  const isLiveMeetingCheckbox = document.getElementById('config-is-live-meeting');
  if (isLiveMeetingCheckbox) {
    isLiveMeetingCheckbox.checked = currentConfig.isLiveMeeting || false;
  }

  const skipLlmCheckbox = document.getElementById('config-skip-llm');
  if (skipLlmCheckbox) {
    skipLlmCheckbox.checked = currentConfig.skipLlm || false;
  }

  // Update visibility of provider-specific fields
  updateProviderVisibility();
}

/**
 * Update visibility of provider-specific fields
 */
function updateProviderVisibility() {
  const providerSelect = document.getElementById('config-provider');
  const provider = providerSelect ? providerSelect.value : 'deepgram';

  const deepgramGroup = document.getElementById('config-deepgram-language-group');
  const localLanguageGroup = document.getElementById('config-local-language-group');
  const whisperModelGroup = document.getElementById('config-whisper-model-group');

  if (provider === 'deepgram') {
    if (deepgramGroup) deepgramGroup.style.display = 'block';
    if (localLanguageGroup) localLanguageGroup.style.display = 'none';
    if (whisperModelGroup) whisperModelGroup.style.display = 'none';
  } else {
    if (deepgramGroup) deepgramGroup.style.display = 'none';
    if (localLanguageGroup) localLanguageGroup.style.display = 'block';
    if (whisperModelGroup) whisperModelGroup.style.display = 'block';
  }
}

/**
 * Handle refresh devices button
 */
async function handleRefreshDevices() {
  await loadDevices();
  showConfigMessage(i18n.t('config.devicesRefreshed'), 'success');
}

/**
 * Show success/error message in config section
 */
function showConfigMessage(message, type = 'success') {
  const messageDiv = document.getElementById('config-message');
  if (!messageDiv) return;

  messageDiv.textContent = message;
  messageDiv.className = `config-message ${type}`;
  messageDiv.style.display = 'block';

  // Auto-hide after 5 seconds
  setTimeout(() => {
    messageDiv.style.display = 'none';
  }, 5000);
}

/**
 * Handle save configuration button
 */
async function handleSaveConfig() {
  const providerSelect = document.getElementById('config-provider');
  const micSelect = document.getElementById('config-device-mic');
  const systemSelect = document.getElementById('config-device-system');
  const deepgramLanguageInput = document.getElementById('config-deepgram-language');
  const localLanguageInput = document.getElementById('config-local-language');
  const whisperModelSelect = document.getElementById('config-whisper-model');
  const isLiveMeetingCheckbox = document.getElementById('config-is-live-meeting');
  const skipLlmCheckbox = document.getElementById('config-skip-llm');

  const configUpdate = {
    transcriptionProvider: providerSelect ? providerSelect.value : 'deepgram',
    audioDeviceIdMic: micSelect ? micSelect.value : '',
    audioDeviceIdSystem: systemSelect ? systemSelect.value : '',
    deepgramLanguage: deepgramLanguageInput ? deepgramLanguageInput.value : 'en',
    localTranscriptionLanguage: localLanguageInput ? localLanguageInput.value : 'en',
    localWhisperModel: whisperModelSelect ? whisperModelSelect.value : 'base',
    isLiveMeeting: isLiveMeetingCheckbox ? isLiveMeetingCheckbox.checked : false,
    skipLlm: skipLlmCheckbox ? skipLlmCheckbox.checked : false,
  };

  try {
    const response = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(configUpdate),
    });

    if (!response.ok) {
      const error = await response.json();
      showConfigMessage(error.error || i18n.t('config.saveError'), 'error');
      return;
    }

    const result = await response.json();
    currentConfig = result.config;
    showConfigMessage(i18n.t('config.saveSuccess'), 'success');
  } catch (err) {
    console.error('Error saving config:', err);
    showConfigMessage(i18n.t('config.genericError', { message: err.message }), 'error');
  }
}

/**
 * Initialize Phase 3: Configuration
 */
function initializeConfiguration() {
  const btnRefresh = document.getElementById('btn-refresh-devices');
  const btnSave = document.getElementById('btn-save-config');
  const providerSelect = document.getElementById('config-provider');

  if (btnRefresh) {
    btnRefresh.addEventListener('click', handleRefreshDevices);
  }

  if (btnSave) {
    btnSave.addEventListener('click', handleSaveConfig);
  }

  if (providerSelect) {
    providerSelect.addEventListener('change', updateProviderVisibility);
  }

  // Load initial configuration and devices
  loadConfiguration();
  loadDevices();
}

// Phase 4: Meeting History State
let currentHistoryMeeting = null;
let currentHistoryView = 'transcript';

/**
 * Load and display the list of meetings
 */
async function loadHistoryList() {
  try {
    const response = await fetch('/api/meetings');
    if (!response.ok) {
      console.error('Failed to load meetings:', response.statusText);
      return;
    }

    const meetings = await response.json();
    populateHistoryList(meetings);
  } catch (err) {
    console.error('Error loading meetings:', err);
  }
}

/**
 * Populate the history list UI
 */
function populateHistoryList(meetings) {
  const listContainer = document.getElementById('history-list');
  if (!listContainer) return;

  listContainer.innerHTML = '';

  if (meetings.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'viewer-placeholder';
    empty.textContent = i18n.t('history.empty');
    listContainer.appendChild(empty);
    return;
  }

  for (const meeting of meetings) {
    const item = document.createElement('div');
    item.className = 'history-item';
    if (currentHistoryMeeting === meeting.prefix) {
      item.classList.add('active');
    }

    // Format date from mtimeMs using the active UI locale
    const date = new Date(meeting.mtimeMs);
    const dateLocale = i18n.current() === 'en' ? 'en-US' : 'it-IT';
    const dateStr = date.toLocaleString(dateLocale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    // Format size
    const sizeKb = Math.round(meeting.sizeBytes / 1024);
    const sizeStr = sizeKb > 0 ? `${sizeKb} KB` : '0 KB';

    // Create title
    const title = document.createElement('div');
    title.className = 'history-item-title';
    title.textContent = meeting.prefix;

    // Create metadata
    const meta = document.createElement('div');
    meta.className = 'history-item-meta';
    meta.textContent = `${dateStr}  •  ${sizeStr}`;

    // Create icons
    const icons = document.createElement('div');
    icons.className = 'history-item-icons';

    if (meeting.hasTranscript) {
      const transcriptIcon = document.createElement('span');
      transcriptIcon.className = 'history-item-icon';
      transcriptIcon.textContent = '📄';
      transcriptIcon.title = i18n.t('history.transcriptAvailable');
      icons.appendChild(transcriptIcon);
    }

    if (meeting.hasRecap) {
      const recapIcon = document.createElement('span');
      recapIcon.className = 'history-item-icon';
      recapIcon.textContent = '📝';
      recapIcon.title = i18n.t('history.recapAvailable');
      icons.appendChild(recapIcon);
    }

    item.appendChild(title);
    item.appendChild(meta);
    item.appendChild(icons);

    item.addEventListener('click', () => {
      handleSelectMeeting(meeting.prefix);
    });

    listContainer.appendChild(item);
  }
}

/**
 * Handle selecting a meeting from the list
 */
async function handleSelectMeeting(prefix) {
  try {
    const response = await fetch(`/api/meetings/${encodeURIComponent(prefix)}`);
    if (!response.ok) {
      console.error('Failed to load meeting:', response.statusText);
      return;
    }

    const meeting = await response.json();
    currentHistoryMeeting = prefix;
    currentHistoryView = 'transcript';

    // Update UI
    const listItems = document.querySelectorAll('.history-item');
    listItems.forEach(item => {
      item.classList.remove('active');
    });
    event.currentTarget?.classList.add('active');

    // Update viewer header (drop data-i18n so a language switch won't overwrite the meeting name)
    const viewerTitle = document.getElementById('viewer-title');
    if (viewerTitle) {
      viewerTitle.removeAttribute('data-i18n');
      viewerTitle.textContent = prefix;
    }

    // Show/enable tabs
    const viewerTabs = document.getElementById('viewer-tabs');
    if (viewerTabs) {
      viewerTabs.style.display = 'flex';
    }

    const recapButton = document.getElementById('btn-recap-tab');
    if (recapButton) {
      recapButton.disabled = meeting.recap === null;
    }

    // Display content
    displayHistoryContent(meeting.transcript, meeting.recap);
  } catch (err) {
    console.error('Error loading meeting:', err);
  }
}

/**
 * Display transcript or recap in the viewer
 */
function displayHistoryContent(transcript, recap) {
  const content = document.getElementById('viewer-content');
  if (!content) return;

  let text = '';
  if (currentHistoryView === 'transcript') {
    text = transcript || '';
  } else if (currentHistoryView === 'recap') {
    text = recap || '';
  }

  content.innerHTML = '';
  const pre = document.createElement('pre');
  pre.textContent = text;
  content.appendChild(pre);
}

/**
 * Handle viewer tab button clicks
 */
function handleViewerTabClick(event) {
  const viewButton = event.currentTarget;
  const view = viewButton.getAttribute('data-view');

  // Update active tab
  const tabButtons = document.querySelectorAll('.viewer-tab-button');
  tabButtons.forEach(btn => {
    btn.classList.remove('active');
  });
  viewButton.classList.add('active');

  // Update current view and refresh content
  currentHistoryView = view;

  if (currentHistoryMeeting) {
    // Fetch and redisplay
    fetch(`/api/meetings/${encodeURIComponent(currentHistoryMeeting)}`)
      .then(res => res.json())
      .then(meeting => {
        displayHistoryContent(meeting.transcript, meeting.recap);
      })
      .catch(err => console.error('Error refreshing content:', err));
  }
}

/**
 * Initialize Phase 4: Meeting History
 */
function initializeHistory() {
  const btnRefresh = document.getElementById('btn-refresh-history');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', loadHistoryList);
  }

  const tabButtons = document.querySelectorAll('.viewer-tab-button');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', handleViewerTabClick);
  });

  // Load initial history list
  loadHistoryList();
}

/**
 * Handle WS message to refresh history on meeting stop
 */
function setupHistoryAutoRefresh() {
  // Wrap existing 'status' handler to also refresh history
  const originalStatusHandler = wsClient.handlers['status'];
  wsClient.registerHandler('status', (data) => {
    // Call original handler first
    if (originalStatusHandler) {
      originalStatusHandler(data);
    }

    // Refresh history list if a meeting stopped
    if (data.state === 'stopped') {
      loadHistoryList();
    }
  });

  // Wrap existing 'batch-progress' handler to also refresh history
  const originalBatchHandler = wsClient.handlers['batch-progress'];
  wsClient.registerHandler('batch-progress', (data) => {
    // Call original handler first
    if (originalBatchHandler) {
      originalBatchHandler(data);
    }

    // Refresh history list if batch is done
    if (data.state === 'done') {
      loadHistoryList();
    }
  });
}

/**
 * Re-render dynamic chrome that isn't covered by static [data-i18n] elements.
 * Called after a language switch (i18n.apply() has already run).
 */
function onLanguageChange() {
  updateMeetingStatus(currentMeetingState, lastStatusMessage);
}

/**
 * Initialize i18n: detect language, load dictionary, translate the static DOM,
 * and wire the language dropdown.
 */
async function initializeI18n() {
  const select = document.getElementById('lang-select');
  await i18n.load(i18n.detect());
  i18n.apply();
  if (select) {
    select.value = i18n.current();
    select.addEventListener('change', () => i18n.setLanguage(select.value));
  }
  i18n.setOnChange(onLanguageChange);

  // Translate the initial meeting-status text (set dynamically, not via [data-i18n])
  updateMeetingStatus(currentMeetingState, lastStatusMessage);
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
  await initializeI18n();

  initializeTabs();
  initializeLiveMeeting();
  initializeBatchTranscription();
  initializeConfiguration();
  initializeHistory();
  setupHistoryAutoRefresh();

  // On connection, request current transcript
  setTimeout(() => {
    wsClient.send({ command: 'getTranscript' });
  }, 500);

  console.log('MeetingTwin frontend initialized');
});
