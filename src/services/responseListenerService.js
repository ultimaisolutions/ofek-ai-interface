// Response Listener Service for handling webhook responses
// Implements SSE, WebSocket, and polling fallback mechanisms

class ResponseListenerService {
  constructor() {
    this.eventSource = null;
    this.webSocket = null;
    this.pollingInterval = null;
    this.messageHandlers = new Map();
    this.connectionStatus = 'disconnected'; // disconnected, connecting, connected, error
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.baseReconnectDelay = 1000;
    this.listeners = [];
    this.pendingMessages = new Map(); // Track messages waiting for responses

    // Configuration
    this.config = {
      sseEndpoint: 'https://ultimaisolutions.app.n8n.cloud/webhook-test/interface-chat/responses',
      wsEndpoint: 'wss://ultimaisolutions.app.n8n.cloud/webhook-test/interface-chat/ws',
      pollingEndpoint: 'https://ultimaisolutions.app.n8n.cloud/webhook-test/interface-chat/poll',
      pollingInterval: 2000,
      connectionTimeout: 10000,
      responseTimeout: 30000
    };
  }

  // Add event listener for status changes and message responses
  addEventListener(type, handler) {
    this.listeners.push({ type, handler });
  }

  // Remove event listener
  removeEventListener(type, handler) {
    this.listeners = this.listeners.filter(
      listener => listener.type !== type || listener.handler !== handler
    );
  }

  // Emit events to all listeners
  emit(type, data) {
    this.listeners.forEach(listener => {
      if (listener.type === type) {
        try {
          listener.handler(data);
        } catch (error) {
          console.error('Error in response listener handler:', error);
        }
      }
    });
  }

  // Update connection status and notify listeners
  updateConnectionStatus(status) {
    if (this.connectionStatus !== status) {
      this.connectionStatus = status;
      this.emit('statusChange', { status, timestamp: new Date() });
    }
  }

  // Start listening for responses - tries SSE first, then WebSocket, then polling
  async startListening(messageId = null) {
    console.log('Starting response listener...');
    this.updateConnectionStatus('connecting');

    // If messageId provided, track it for response correlation
    if (messageId) {
      this.pendingMessages.set(messageId, {
        timestamp: new Date(),
        timeout: setTimeout(() => {
          this.handleMessageTimeout(messageId);
        }, this.config.responseTimeout)
      });
    }

    // Try SSE first (most efficient)
    if (await this.tryServerSentEvents()) {
      return;
    }

    // Fallback to WebSocket
    if (await this.tryWebSocket()) {
      return;
    }

    // Final fallback to polling
    this.startPolling();
  }

  // Server-Sent Events implementation
  async tryServerSentEvents() {
    try {
      console.log('Attempting SSE connection...');

      this.eventSource = new EventSource(this.config.sseEndpoint);

      this.eventSource.onopen = () => {
        console.log('SSE connected successfully');
        this.updateConnectionStatus('connected');
        this.reconnectAttempts = 0;
      };

      this.eventSource.onmessage = (event) => {
        this.handleIncomingMessage(event.data, 'sse');
      };

      this.eventSource.onerror = (error) => {
        console.error('SSE connection error:', error);
        this.eventSource.close();
        this.eventSource = null;
        this.handleConnectionError('sse');
      };

      // Wait for connection or timeout
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          if (this.eventSource && this.eventSource.readyState !== EventSource.OPEN) {
            this.eventSource.close();
            this.eventSource = null;
            resolve(false);
          }
        }, this.config.connectionTimeout);

        if (this.eventSource) {
          this.eventSource.onopen = () => {
            clearTimeout(timeout);
            console.log('SSE connected successfully');
            this.updateConnectionStatus('connected');
            this.reconnectAttempts = 0;
            resolve(true);
          };
        }
      });

    } catch (error) {
      console.error('SSE setup failed:', error);
      return false;
    }
  }

  // WebSocket implementation
  async tryWebSocket() {
    try {
      console.log('Attempting WebSocket connection...');

      this.webSocket = new WebSocket(this.config.wsEndpoint);

      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          if (this.webSocket && this.webSocket.readyState !== WebSocket.OPEN) {
            this.webSocket.close();
            this.webSocket = null;
            resolve(false);
          }
        }, this.config.connectionTimeout);

        this.webSocket.onopen = () => {
          clearTimeout(timeout);
          console.log('WebSocket connected successfully');
          this.updateConnectionStatus('connected');
          this.reconnectAttempts = 0;
          resolve(true);
        };

        this.webSocket.onmessage = (event) => {
          this.handleIncomingMessage(event.data, 'websocket');
        };

        this.webSocket.onerror = (error) => {
          clearTimeout(timeout);
          console.error('WebSocket connection error:', error);
          this.webSocket = null;
          resolve(false);
        };

        this.webSocket.onclose = () => {
          this.webSocket = null;
          this.handleConnectionError('websocket');
        };
      });

    } catch (error) {
      console.error('WebSocket setup failed:', error);
      return false;
    }
  }

  // Polling implementation (fallback)
  startPolling() {
    console.log('Starting polling fallback...');
    this.updateConnectionStatus('connected');

    this.pollingInterval = setInterval(async () => {
      try {
        await this.pollForMessages();
      } catch (error) {
        console.error('Polling error:', error);
        this.handleConnectionError('polling');
      }
    }, this.config.pollingInterval);
  }

  // Poll for new messages
  async pollForMessages() {
    const pendingIds = Array.from(this.pendingMessages.keys());
    if (pendingIds.length === 0) return;

    const params = new URLSearchParams({
      messageIds: pendingIds.join(','),
      timestamp: new Date().toISOString()
    });

    const response = await fetch(`${this.config.pollingEndpoint}?${params}`, {
      method: 'GET'
    });

    if (!response.ok) {
      throw new Error(`Polling failed: ${response.status}`);
    }

    const data = await response.text();
    if (data) {
      this.handleIncomingMessage(data, 'polling');
    }
  }

  // Handle incoming messages from any source
  handleIncomingMessage(rawData, source) {
    try {
      console.log(`Received message via ${source}:`, rawData);

      // Try to parse as JSON
      let messageData;
      try {
        messageData = JSON.parse(rawData);
      } catch {
        // Handle plain text responses
        messageData = {
          id: null,
          content: rawData,
          timestamp: new Date().toISOString(),
          source: source
        };
      }

      // Validate message structure
      if (!this.validateMessage(messageData)) {
        console.warn('Invalid message format received:', messageData);
        return;
      }

      // Handle message correlation
      if (messageData.correlationId || messageData.messageId) {
        const messageId = messageData.correlationId || messageData.messageId;

        if (this.pendingMessages.has(messageId)) {
          // Clear timeout for this message
          const pending = this.pendingMessages.get(messageId);
          clearTimeout(pending.timeout);
          this.pendingMessages.delete(messageId);
        }
      }

      // Emit message received event
      this.emit('messageReceived', {
        ...messageData,
        receivedAt: new Date(),
        source: source
      });

    } catch (error) {
      console.error('Error handling incoming message:', error);
      this.emit('error', { error, source: source });
    }
  }

  // Validate incoming message structure
  validateMessage(message) {
    if (typeof message !== 'object' || message === null) return false;

    // Basic validation - at minimum should have content
    if (!message.content && !message.error) return false;

    return true;
  }

  // Handle message timeout
  handleMessageTimeout(messageId) {
    console.warn(`Message timeout for ID: ${messageId}`);

    if (this.pendingMessages.has(messageId)) {
      this.pendingMessages.delete(messageId);

      this.emit('messageTimeout', {
        messageId,
        timestamp: new Date()
      });
    }
  }

  // Handle connection errors and implement reconnection logic
  handleConnectionError(source) {
    console.error(`Connection error in ${source}`);
    this.updateConnectionStatus('error');

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

      console.log(`Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms...`);

      setTimeout(() => {
        this.startListening();
      }, delay);
    } else {
      console.error('Max reconnection attempts reached');
      this.updateConnectionStatus('disconnected');
      this.emit('connectionFailed', {
        attempts: this.reconnectAttempts,
        timestamp: new Date()
      });
    }
  }

  // Stop all listening connections
  stopListening() {
    console.log('Stopping response listener...');

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    if (this.webSocket && this.webSocket.readyState === WebSocket.OPEN) {
      this.webSocket.close();
      this.webSocket = null;
    }

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    // Clear all pending message timeouts
    this.pendingMessages.forEach((pending) => {
      clearTimeout(pending.timeout);
    });
    this.pendingMessages.clear();

    this.updateConnectionStatus('disconnected');
    this.reconnectAttempts = 0;
  }

  // Get current connection status
  getConnectionStatus() {
    return this.connectionStatus;
  }

  // Get pending messages count
  getPendingMessagesCount() {
    return this.pendingMessages.size;
  }

  // Manual retry connection
  retryConnection() {
    console.log('Manual connection retry requested');
    this.reconnectAttempts = 0;
    this.startListening();
  }
}

// Create singleton instance
const responseListenerService = new ResponseListenerService();

export default responseListenerService;
export { ResponseListenerService };