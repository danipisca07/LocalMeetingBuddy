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

// Register default message handlers (will be populated by phases)
wsClient.registerHandler('transcription', (data) => {
  console.log('Transcription received:', data);
});

wsClient.registerHandler('status', (data) => {
  console.log('Status update:', data);
});

wsClient.registerHandler('transcript', (data) => {
  console.log('Transcript:', data);
});

wsClient.registerHandler('ai-response', (data) => {
  console.log('AI response:', data);
});

wsClient.registerHandler('ai-error', (data) => {
  console.error('AI error:', data);
});

wsClient.registerHandler('batch-progress', (data) => {
  console.log('Batch progress:', data);
});

wsClient.registerHandler('error', (data) => {
  console.error('Server error:', data);
});

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

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  initializeTabs();
  console.log('MeetingTwin frontend initialized');
});
