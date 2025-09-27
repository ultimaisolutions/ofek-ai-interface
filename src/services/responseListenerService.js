import httpLogger from './httpLoggerService.js';

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
    httpLogger.createLogEntry('INFO', 'RESPONSE_LISTENER',
      'Starting response listener service',
      {
        messageId,
        currentPendingCount: this.pendingMessages.size,
        connectionStatus: this.connectionStatus
      }
    );

    // Stop any existing connections before starting new ones
    this.stopListening();

    this.updateConnectionStatus('connecting');

    // If messageId provided, track it for response correlation
    if (messageId) {
      httpLogger.logMessageFlow(messageId, 'RESPONSE_TRACKING_START', {
        responseTimeout: this.config.responseTimeout
      });

      this.pendingMessages.set(messageId, {
        timestamp: new Date(),
        timeout: setTimeout(() => {
          this.handleMessageTimeout(messageId);
        }, this.config.responseTimeout)
      });
    } else {
      httpLogger.createLogEntry('WARN', 'RESPONSE_LISTENER',
        'Starting listener without messageId - this may cause unnecessary polling',
        {
          currentPendingCount: this.pendingMessages.size,
          recommendation: 'Only call startListening() with a messageId when expecting a response'
        }
      );
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
    const sseCorrelationId = httpLogger.logSSEEvent('connecting', this.config.sseEndpoint, {
      pendingMessages: this.pendingMessages.size
    });

    try {
      this.eventSource = new EventSource(this.config.sseEndpoint);

      this.eventSource.onopen = () => {
        httpLogger.logSSEEvent('connected', this.config.sseEndpoint, {
          correlationId: sseCorrelationId
        });
        this.updateConnectionStatus('connected');
        this.reconnectAttempts = 0;
      };

      this.eventSource.onmessage = (event) => {
        httpLogger.logSSEEvent('message', this.config.sseEndpoint, {
          correlationId: sseCorrelationId,
          dataPreview: event.data?.substring(0, 100) + (event.data?.length > 100 ? '...' : '')
        });
        this.handleIncomingMessage(event.data, 'sse');
      };

      this.eventSource.onerror = (error) => {
        httpLogger.logSSEEvent('error', this.config.sseEndpoint, {
          correlationId: sseCorrelationId,
          error: error.toString()
        });
        this.eventSource.close();
        this.eventSource = null;
        this.handleConnectionError('sse');
      };

      // Wait for connection or timeout
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          if (this.eventSource && this.eventSource.readyState !== EventSource.OPEN) {
            httpLogger.createLogEntry('WARN', 'SSE',
              'SSE connection timeout', {
                correlationId: sseCorrelationId,
                timeout: this.config.connectionTimeout
              }
            );
            this.eventSource.close();
            this.eventSource = null;
            resolve(false);
          }
        }, this.config.connectionTimeout);

        if (this.eventSource) {
          this.eventSource.onopen = () => {
            clearTimeout(timeout);
            httpLogger.logSSEEvent('connected', this.config.sseEndpoint, {
              correlationId: sseCorrelationId
            });
            this.updateConnectionStatus('connected');
            this.reconnectAttempts = 0;
            resolve(true);
          };
        }
      });

    } catch (error) {
      httpLogger.logSSEEvent('error', this.config.sseEndpoint, {
        correlationId: sseCorrelationId,
        error: error.message,
        stack: error.stack
      });
      return false;
    }
  }

  // WebSocket implementation
  async tryWebSocket() {
    const wsCorrelationId = httpLogger.logWebSocketEvent('connecting', this.config.wsEndpoint, {
      pendingMessages: this.pendingMessages.size
    });

    try {
      this.webSocket = new WebSocket(this.config.wsEndpoint);

      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          if (this.webSocket && this.webSocket.readyState !== WebSocket.OPEN) {
            httpLogger.createLogEntry('WARN', 'WEBSOCKET',
              'WebSocket connection timeout', {
                correlationId: wsCorrelationId,
                timeout: this.config.connectionTimeout
              }
            );
            this.webSocket.close();
            this.webSocket = null;
            resolve(false);
          }
        }, this.config.connectionTimeout);

        this.webSocket.onopen = () => {
          clearTimeout(timeout);
          httpLogger.logWebSocketEvent('connected', this.config.wsEndpoint, {
            correlationId: wsCorrelationId
          });
          this.updateConnectionStatus('connected');
          this.reconnectAttempts = 0;
          resolve(true);
        };

        this.webSocket.onmessage = (event) => {
          httpLogger.logWebSocketEvent('message', this.config.wsEndpoint, {
            correlationId: wsCorrelationId,
            dataPreview: event.data?.substring(0, 100) + (event.data?.length > 100 ? '...' : '')
          });
          this.handleIncomingMessage(event.data, 'websocket');
        };

        this.webSocket.onerror = (error) => {
          clearTimeout(timeout);
          httpLogger.logWebSocketEvent('error', this.config.wsEndpoint, {
            correlationId: wsCorrelationId,
            error: error.toString()
          });
          this.webSocket = null;
          resolve(false);
        };

        this.webSocket.onclose = () => {
          httpLogger.logWebSocketEvent('closed', this.config.wsEndpoint, {
            correlationId: wsCorrelationId
          });
          this.webSocket = null;
          this.handleConnectionError('websocket');
        };
      });

    } catch (error) {
      httpLogger.logWebSocketEvent('error', this.config.wsEndpoint, {
        correlationId: wsCorrelationId,
        error: error.message,
        stack: error.stack
      });
      return false;
    }
  }

  // Polling implementation (fallback)
  startPolling() {
    httpLogger.createLogEntry('WARN', 'RESPONSE_LISTENER',
      'Falling back to polling - this will generate continuous GET requests',
      {
        pollingInterval: this.config.pollingInterval,
        pendingMessages: this.pendingMessages.size,
        pollingEndpoint: this.config.pollingEndpoint
      }
    );

    this.updateConnectionStatus('connected');

    this.pollingInterval = setInterval(async () => {
      try {
        await this.pollForMessages();
      } catch (error) {
        httpLogger.createLogEntry('ERROR', 'POLLING',
          'Polling error occurred', {
            error: error.message,
            stack: error.stack,
            pendingMessages: this.pendingMessages.size
          }
        );
        this.handleConnectionError('polling');
      }
    }, this.config.pollingInterval);

    // Log initial polling start
    httpLogger.logPerformance('POLLING_START', 0, {
      intervalMs: this.config.pollingInterval,
      endpoint: this.config.pollingEndpoint
    });
  }

  // Poll for new messages
  async pollForMessages() {
    const pendingIds = Array.from(this.pendingMessages.keys());

    // FIXED: Stop polling when no pending messages - prevents unnecessary GET requests!
    if (pendingIds.length === 0) {
      httpLogger.createLogEntry('INFO', 'POLLING',
        'No pending messages - stopping polling to prevent unnecessary requests',
        {
          pollingEndpoint: this.config.pollingEndpoint,
          pollingInterval: this.config.pollingInterval,
          action: 'stopping_polling_interval'
        }
      );

      // Clear the polling interval when no messages are pending
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
        this.pollingInterval = null;
        httpLogger.createLogEntry('INFO', 'POLLING', 'Polling interval stopped - no more unnecessary requests', {});
      }
      return;
    }

    const params = new URLSearchParams({
      messageIds: pendingIds.join(','),
      timestamp: new Date().toISOString()
    });

    const requestUrl = `${this.config.pollingEndpoint}?${params}`;

    // Log the polling request
    const requestLogger = httpLogger.logHttpRequest('GET', requestUrl);

    httpLogger.createLogEntry('DEBUG', 'POLLING',
      `Polling for ${pendingIds.length} pending message(s)`,
      {
        pendingIds,
        pollingEndpoint: this.config.pollingEndpoint
      }
    );

    const response = await fetch(requestUrl, {
      method: 'GET'
    });

    if (!response.ok) {
      const error = new Error(`Polling failed: ${response.status}`);
      requestLogger.logResponse(response, null, error);
      throw error;
    }

    const data = await response.text();
    requestLogger.logResponse(response, data);

    if (data) {
      httpLogger.createLogEntry('INFO', 'POLLING',
        'Received data from polling', {
          dataLength: data.length,
          dataPreview: data.substring(0, 100) + (data.length > 100 ? '...' : '')
        }
      );
      this.handleIncomingMessage(data, 'polling');
    } else {
      httpLogger.createLogEntry('DEBUG', 'POLLING',
        'No data received from polling request', {
          pendingIds
        }
      );
    }
  }

  // Handle incoming messages from any source
  handleIncomingMessage(rawData, source) {
    try {
      httpLogger.createLogEntry('INFO', 'MESSAGE_RECEIVED',
        `Received message via ${source}`,
        {
          source,
          dataLength: rawData?.length || 0,
          dataPreview: rawData?.substring(0, 200) + (rawData?.length > 200 ? '...' : '')
        }
      );

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
        httpLogger.createLogEntry('WARN', 'MESSAGE_RECEIVED',
          'Invalid message format received',
          { messageData, source }
        );
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

          httpLogger.logMessageFlow(messageId, 'RESPONSE_RECEIVED_AND_CORRELATED', {
            source,
            pendingRemovedCount: 1,
            remainingPending: this.pendingMessages.size
          });
        } else {
          httpLogger.createLogEntry('WARN', 'MESSAGE_RECEIVED',
            'Received response for unknown message ID',
            { messageId, source, currentPendingIds: Array.from(this.pendingMessages.keys()) }
          );
        }
      } else {
        httpLogger.createLogEntry('WARN', 'MESSAGE_RECEIVED',
          'Received message without correlation ID',
          { messageData, source }
        );
      }

      // Emit message received event
      this.emit('messageReceived', {
        ...messageData,
        receivedAt: new Date(),
        source: source
      });

    } catch (error) {
      httpLogger.createLogEntry('ERROR', 'MESSAGE_RECEIVED',
        'Error handling incoming message',
        {
          error: error.message,
          stack: error.stack,
          source,
          rawData: rawData?.substring(0, 500)
        }
      );
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

      httpLogger.createLogEntry('INFO', 'RESPONSE_LISTENER',
        `Attempting automatic reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`,
        {
          pendingMessagesCount: this.pendingMessages.size,
          source: source
        }
      );

      setTimeout(() => {
        // Only reconnect if there are still pending messages
        if (this.pendingMessages.size > 0) {
          httpLogger.createLogEntry('INFO', 'RESPONSE_LISTENER',
            'Reconnecting because there are pending messages',
            {
              pendingMessagesCount: this.pendingMessages.size,
              pendingMessageIds: Array.from(this.pendingMessages.keys())
            }
          );
          this.startListening();
        } else {
          httpLogger.createLogEntry('WARN', 'RESPONSE_LISTENER',
            'Skipping reconnection - no pending messages to listen for',
            {
              reconnectAttempt: this.reconnectAttempts
            }
          );
          this.updateConnectionStatus('disconnected');
        }
      }, delay);
    } else {
      httpLogger.createLogEntry('ERROR', 'RESPONSE_LISTENER',
        'Max reconnection attempts reached',
        {
          maxAttempts: this.maxReconnectAttempts,
          pendingMessagesCount: this.pendingMessages.size
        }
      );
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
    httpLogger.createLogEntry('INFO', 'RESPONSE_LISTENER', 'Manual connection retry requested', {
      pendingMessagesCount: this.pendingMessages.size,
      pendingMessageIds: Array.from(this.pendingMessages.keys())
    });

    // Only retry if there are pending messages to listen for
    if (this.pendingMessages.size === 0) {
      httpLogger.createLogEntry('WARN', 'RESPONSE_LISTENER',
        'Retry connection called but no pending messages - not starting listener to avoid unnecessary requests',
        {
          recommendation: 'Only retry when there are messages awaiting responses'
        }
      );

      // Just reset the status without starting polling
      this.updateConnectionStatus('disconnected');
      this.reconnectAttempts = 0;
      return;
    }

    // Only retry if there are messages pending
    this.reconnectAttempts = 0;
    this.startListening();
  }
}

// Create singleton instance
const responseListenerService = new ResponseListenerService();

export default responseListenerService;
export { ResponseListenerService };