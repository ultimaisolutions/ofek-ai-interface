// HTTP Logger Service for comprehensive request/response tracking
// Provides structured logging with correlation IDs, performance metrics, and debug capabilities

class HttpLoggerService {
  constructor() {
    this.logs = [];
    this.maxLogs = 1000; // Rotate logs to prevent memory issues
    this.logLevels = {
      DEBUG: 0,
      INFO: 1,
      WARN: 2,
      ERROR: 3
    };
    this.currentLogLevel = this.logLevels.DEBUG; // Show all logs by default
  }

  // Generate correlation ID for request tracking
  generateCorrelationId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // Create structured log entry
  createLogEntry(level, category, message, data = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      data: JSON.parse(JSON.stringify(data)), // Deep clone to prevent mutations
      correlationId: data.correlationId || null
    };

    this.addLog(logEntry);
    this.outputToConsole(logEntry);
    return logEntry;
  }

  // Add log to internal storage with rotation
  addLog(logEntry) {
    this.logs.push(logEntry);

    // Rotate logs if we exceed max
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    // Persist to localStorage (with rotation)
    this.persistLogs();
  }

  // Output structured log to browser console
  outputToConsole(logEntry) {
    if (this.logLevels[logEntry.level] < this.currentLogLevel) {
      return; // Skip if below current log level
    }

    const timestamp = new Date(logEntry.timestamp).toLocaleTimeString();
    const prefix = `[${logEntry.level}] ${timestamp} [${logEntry.category}]`;

    // Style logs by level
    const styles = {
      DEBUG: 'color: #666; font-weight: normal;',
      INFO: 'color: #0066cc; font-weight: bold;',
      WARN: 'color: #ff9900; font-weight: bold;',
      ERROR: 'color: #cc0000; font-weight: bold;'
    };

    // Use console grouping for better organization
    if (logEntry.data && Object.keys(logEntry.data).length > 0) {
      console.groupCollapsed(`%c${prefix} ${logEntry.message}`, styles[logEntry.level]);
      console.table(logEntry.data);
      console.groupEnd();
    } else {
      console.log(`%c${prefix} ${logEntry.message}`, styles[logEntry.level]);
    }
  }

  // Log HTTP request start
  logHttpRequest(method, url, options = {}) {
    const correlationId = this.generateCorrelationId();
    const startTime = Date.now();

    const requestData = {
      correlationId,
      method: method.toUpperCase(),
      url,
      headers: options.headers || {},
      body: options.body || null,
      startTime,
      retryAttempt: options.retryAttempt || 0
    };

    this.createLogEntry('INFO', 'HTTP_REQUEST',
      `${method.toUpperCase()} ${url}`,
      requestData
    );

    return {
      correlationId,
      startTime,
      // Helper function to log response
      logResponse: (response, responseData = null, error = null) => {
        this.logHttpResponse(correlationId, startTime, response, responseData, error);
      }
    };
  }

  // Log HTTP response
  logHttpResponse(correlationId, startTime, response, responseData = null, error = null) {
    const endTime = Date.now();
    const duration = endTime - startTime;

    if (error) {
      this.createLogEntry('ERROR', 'HTTP_RESPONSE',
        `Request failed after ${duration}ms`,
        {
          correlationId,
          duration,
          error: error.message,
          stack: error.stack
        }
      );
    } else {
      const level = response.ok ? 'INFO' : 'WARN';
      const message = `${response.status} ${response.statusText} (${duration}ms)`;

      this.createLogEntry(level, 'HTTP_RESPONSE', message, {
        correlationId,
        status: response.status,
        statusText: response.statusText,
        headers: this.extractHeaders(response),
        responseData: responseData ? this.truncateData(responseData) : null,
        duration
      });
    }
  }

  // Log WebSocket connection attempts
  logWebSocketEvent(event, url, data = {}) {
    const correlationId = data.correlationId || this.generateCorrelationId();

    const eventLevels = {
      'connecting': 'INFO',
      'connected': 'INFO',
      'message': 'DEBUG',
      'error': 'ERROR',
      'closed': 'WARN'
    };

    this.createLogEntry(
      eventLevels[event] || 'DEBUG',
      'WEBSOCKET',
      `WebSocket ${event}: ${url}`,
      { ...data, correlationId, url }
    );

    return correlationId;
  }

  // Log Server-Sent Events
  logSSEEvent(event, url, data = {}) {
    const correlationId = data.correlationId || this.generateCorrelationId();

    const eventLevels = {
      'connecting': 'INFO',
      'connected': 'INFO',
      'message': 'DEBUG',
      'error': 'ERROR',
      'closed': 'WARN'
    };

    this.createLogEntry(
      eventLevels[event] || 'DEBUG',
      'SSE',
      `Server-Sent Event ${event}: ${url}`,
      { ...data, correlationId, url }
    );

    return correlationId;
  }

  // Log application state changes
  logStateChange(component, state, oldValue, newValue, context = {}) {
    this.createLogEntry('DEBUG', 'STATE_CHANGE',
      `${component}: ${state} changed`,
      {
        component,
        state,
        oldValue: this.truncateData(oldValue),
        newValue: this.truncateData(newValue),
        context
      }
    );
  }

  // Log message flow tracking
  logMessageFlow(messageId, stage, data = {}) {
    this.createLogEntry('INFO', 'MESSAGE_FLOW',
      `Message ${messageId}: ${stage}`,
      {
        messageId,
        stage,
        timestamp: new Date().toISOString(),
        ...data
      }
    );
  }

  // Log performance metrics
  logPerformance(operation, duration, data = {}) {
    const level = duration > 5000 ? 'WARN' : 'INFO'; // Warn if over 5 seconds

    this.createLogEntry(level, 'PERFORMANCE',
      `${operation} completed in ${duration}ms`,
      {
        operation,
        duration,
        ...data
      }
    );
  }

  // Utility: Extract headers from Response object
  extractHeaders(response) {
    const headers = {};
    if (response.headers) {
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
    }
    return headers;
  }

  // Utility: Truncate large data for logging
  truncateData(data, maxLength = 1000) {
    if (!data) return data;

    const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
    if (dataStr.length <= maxLength) return data;

    return {
      _truncated: true,
      _originalLength: dataStr.length,
      _data: dataStr.substring(0, maxLength) + '...'
    };
  }

  // Persist logs to localStorage
  persistLogs() {
    try {
      const logsToSave = this.logs.slice(-100); // Save last 100 logs
      localStorage.setItem('ai-interface-http-logs', JSON.stringify(logsToSave));
    } catch (error) {
      console.warn('Failed to persist logs to localStorage:', error);
    }
  }

  // Load logs from localStorage
  loadPersistedLogs() {
    try {
      const savedLogs = localStorage.getItem('ai-interface-http-logs');
      if (savedLogs) {
        const parsedLogs = JSON.parse(savedLogs);
        this.logs = [...parsedLogs, ...this.logs];
      }
    } catch (error) {
      console.warn('Failed to load persisted logs:', error);
    }
  }

  // Get logs with filtering options
  getLogs(options = {}) {
    let filteredLogs = [...this.logs];

    // Filter by level
    if (options.level) {
      const minLevel = this.logLevels[options.level];
      filteredLogs = filteredLogs.filter(log =>
        this.logLevels[log.level] >= minLevel
      );
    }

    // Filter by category
    if (options.category) {
      filteredLogs = filteredLogs.filter(log =>
        log.category === options.category
      );
    }

    // Filter by correlation ID
    if (options.correlationId) {
      filteredLogs = filteredLogs.filter(log =>
        log.correlationId === options.correlationId
      );
    }

    // Filter by time range
    if (options.since) {
      const sinceTime = new Date(options.since);
      filteredLogs = filteredLogs.filter(log =>
        new Date(log.timestamp) >= sinceTime
      );
    }

    return filteredLogs;
  }

  // Export logs as JSON
  exportLogs(filename = `http-logs-${new Date().toISOString().split('T')[0]}.json`) {
    const dataStr = JSON.stringify(this.logs, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', filename);
    linkElement.click();
  }

  // Clear all logs
  clearLogs() {
    this.logs = [];
    localStorage.removeItem('ai-interface-http-logs');
    this.createLogEntry('INFO', 'LOGGER', 'All logs cleared');
  }

  // Set log level
  setLogLevel(level) {
    if (this.logLevels[level] !== undefined) {
      this.currentLogLevel = this.logLevels[level];
      this.createLogEntry('INFO', 'LOGGER', `Log level set to ${level}`);
    }
  }

  // Get summary statistics
  getLogSummary() {
    const summary = {
      totalLogs: this.logs.length,
      byLevel: {},
      byCategory: {},
      timeRange: null
    };

    // Count by level and category
    this.logs.forEach(log => {
      summary.byLevel[log.level] = (summary.byLevel[log.level] || 0) + 1;
      summary.byCategory[log.category] = (summary.byCategory[log.category] || 0) + 1;
    });

    // Time range
    if (this.logs.length > 0) {
      const timestamps = this.logs.map(log => new Date(log.timestamp));
      summary.timeRange = {
        earliest: new Date(Math.min(...timestamps)).toISOString(),
        latest: new Date(Math.max(...timestamps)).toISOString()
      };
    }

    return summary;
  }
}

// Create singleton instance
const httpLogger = new HttpLoggerService();

// Load any persisted logs on startup
httpLogger.loadPersistedLogs();

// Expose to window for debugging
if (typeof window !== 'undefined') {
  window.httpLogger = httpLogger;
}

export default httpLogger;
export { HttpLoggerService };