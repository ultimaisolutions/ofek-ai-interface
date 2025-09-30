import httpLogger from './httpLoggerService.js';

// Simple UUID v4 generation function
const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

// Export test connection URL
export const testConnectionUrl = 'https://ultimaisolutions.app.n8n.cloud/healthz';

// Test n8n instance connection
export const testN8nConnection = async () => {
  httpLogger.createLogEntry('INFO', 'CONNECTION_TEST',
    'Testing n8n instance connection',
    { endpoint: testConnectionUrl }
  );

  const requestLogger = httpLogger.logHttpRequest('GET', testConnectionUrl, {
    purpose: 'health_check'
  });

  try {
    // Use 'no-cors' mode to bypass CORS restrictions
    // For health checks, we only need to know if the endpoint responds
    // We don't need to read response data or check status codes
    const response = await fetch(testConnectionUrl, {
      method: 'GET',
      mode: 'no-cors', // Bypasses CORS - request succeeds if endpoint is reachable
      signal: AbortSignal.timeout(5000) // 5 second timeout
    });

    // With 'no-cors' mode, we can't read status or body, but if fetch succeeds,
    // it means the endpoint is reachable and responding
    requestLogger.logResponse(response, 'Health check passed - endpoint reachable');

    httpLogger.createLogEntry('INFO', 'CONNECTION_TEST',
      'n8n instance health check succeeded',
      {
        endpoint: testConnectionUrl,
        note: 'Connection successful (no-cors mode)'
      }
    );

    return {
      success: true,
      status: 'connected',
      timestamp: new Date()
    };

  } catch (error) {
    requestLogger.logResponse(null, null, error);

    httpLogger.createLogEntry('ERROR', 'CONNECTION_TEST',
      'n8n instance health check exception',
      {
        error: error.message,
        stack: error.stack,
        endpoint: testConnectionUrl
      }
    );

    return {
      success: false,
      status: 'error',
      error: error.name === 'TimeoutError'
        ? 'Connection timeout - n8n instance may be unreachable'
        : `Connection error: ${error.message}`,
      timestamp: new Date()
    };
  }
};

// Webhook service for sending message data with response correlation
export const sendMessageToWebhook = async (message, options = {}) => {
  const webhookUrl = 'https://ultimaisolutions.app.n8n.cloud/webhook/interface-chat';

  // Generate unique message ID if not provided
  const messageId = message.id || generateUUID();

  // Log message flow start
  httpLogger.logMessageFlow(messageId, 'WEBHOOK_SEND_START', {
    messageContent: message.content?.substring(0, 100) + (message.content?.length > 100 ? '...' : ''),
    options
  });

  // Validate that session ID is provided
  if (!options.sessionId) {
    throw new Error('Session ID is required but was not provided')
  }

  // Prepare query parameters with response correlation
  const params = new URLSearchParams({
    messageType: message.type || 'text',
    content: message.content || '',
    timestamp: message.timestamp ? message.timestamp.toISOString() : new Date().toISOString(),
    messageId: messageId.toString(),
    expectResponse: options.expectResponse !== false ? 'true' : 'false',
    responseFormat: options.responseFormat || 'json',
    userId: options.userId || 'anonymous',
    sessionId: options.sessionId
  });

  // Add file attachment metadata if present
  if (message.fileAttachments && message.fileAttachments.length > 0) {
    const fileData = message.fileAttachments.map(file => ({
      id: file.id,
      fileName: file.file_name,
      fileType: file.file_type,
      fileSize: file.file_size,
      downloadUrl: file.download_url,
      thumbnailUrl: file.thumbnail_url
    }));

    params.append('hasFiles', 'true');
    params.append('fileCount', message.fileAttachments.length.toString());
    params.append('fileMetadata', JSON.stringify(fileData));

    // Log file attachments being sent
    httpLogger.logMessageFlow(messageId, 'WEBHOOK_FILES_INCLUDED', {
      fileCount: message.fileAttachments.length,
      fileTypes: message.fileAttachments.map(f => f.file_type),
      totalSize: message.fileAttachments.reduce((sum, f) => sum + f.file_size, 0)
    });
  }

  const requestUrl = `${webhookUrl}?${params.toString()}`;

  // Start HTTP request logging
  const requestLogger = httpLogger.logHttpRequest('GET', requestUrl, {
    retryAttempt: options.retryAttempt || 0
  });

  try {
    // Send GET request to webhook (no custom headers to avoid CORS preflight)
    const response = await fetch(requestUrl, {
      method: 'GET'
    });

    if (!response.ok) {
      const error = new Error(`Webhook request failed: ${response.status} ${response.statusText}`);
      requestLogger.logResponse(response, null, error);
      throw error;
    }

    // Return response data if available
    const data = await response.text();

    // Log the raw response
    requestLogger.logResponse(response, data);

    // Check if this is an immediate response or acknowledgment
    let parsedData = null;
    let isAcknowledgment = false;
    let responseType = 'unknown';

    try {
      parsedData = JSON.parse(data);

      // Handle array response format: [{"output": "message"}]
      if (Array.isArray(parsedData) && parsedData.length > 0 && parsedData[0].output) {
        parsedData = { content: parsedData[0].output };
        responseType = 'immediate_response';
        isAcknowledgment = false;
      } else {
        // Handle object response format: {"status": "acknowledged"} or {"content": "message"}
        isAcknowledgment = parsedData.status === 'acknowledged' || parsedData.type === 'acknowledgment';
        responseType = isAcknowledgment ? 'acknowledgment' : 'immediate_response';
      }
    } catch {
      // Plain text response
      parsedData = { content: data };
      responseType = data ? 'text_response' : 'empty_response';
    }

    // Log message flow outcome
    httpLogger.logMessageFlow(messageId, 'WEBHOOK_RESPONSE_RECEIVED', {
      responseType,
      isAcknowledgment,
      responseLength: data?.length || 0,
      responsePreview: data?.substring(0, 200) + (data?.length > 200 ? '...' : '')
    });

    // Log if acknowledgment triggers response listener
    if (isAcknowledgment) {
      httpLogger.createLogEntry('WARN', 'MESSAGE_FLOW',
        `Message ${messageId}: Acknowledgment received - will trigger response listener system`,
        { messageId, parsedData }
      );
    }

    return {
      success: true,
      data: parsedData,
      rawData: data,
      messageId: messageId,
      isAcknowledgment: isAcknowledgment,
      timestamp: new Date(),
      requestUrl: requestUrl,
      correlationId: requestLogger.correlationId
    };

  } catch (error) {
    // Log error with full context
    httpLogger.logMessageFlow(messageId, 'WEBHOOK_ERROR', {
      error: error.message,
      requestUrl,
      stack: error.stack
    });

    // Return error details
    return {
      success: false,
      error: error.message,
      messageId: messageId,
      requestUrl: requestUrl,
      timestamp: new Date(),
      correlationId: requestLogger.correlationId
    };
  }
};

// Retry logic with exponential backoff
export const sendMessageToWebhookWithRetry = async (message, options = {}, maxRetries = 3, baseDelay = 1000) => {
  const messageId = message.id || generateUUID();
  let lastError;
  let lastResult;

  httpLogger.logMessageFlow(messageId, 'WEBHOOK_RETRY_START', {
    maxRetries,
    baseDelay
  });

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Add retry attempt info to options
      const retryOptions = { ...options, retryAttempt: attempt };
      const result = await sendMessageToWebhook(message, retryOptions);

      if (result.success) {
        if (attempt > 0) {
          httpLogger.logMessageFlow(messageId, 'WEBHOOK_RETRY_SUCCESS', {
            attempt: attempt + 1,
            totalAttempts: maxRetries
          });
        }
        return result;
      }

      lastError = result.error;
      lastResult = result;

      // Don't retry on the last attempt
      if (attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        httpLogger.createLogEntry('WARN', 'MESSAGE_FLOW',
          `Message ${messageId}: Retry ${attempt + 1}/${maxRetries} in ${delay}ms`,
          { messageId, attempt, delay, error: lastError }
        );
        await new Promise(resolve => setTimeout(resolve, delay));
      }

    } catch (error) {
      lastError = error.message;

      // Don't retry on the last attempt
      if (attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        httpLogger.createLogEntry('ERROR', 'MESSAGE_FLOW',
          `Message ${messageId}: Retry ${attempt + 1}/${maxRetries} in ${delay}ms (Exception)`,
          { messageId, attempt, delay, error: error.message, stack: error.stack }
        );
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // All retries failed
  httpLogger.logMessageFlow(messageId, 'WEBHOOK_RETRY_FAILED', {
    totalAttempts: maxRetries,
    finalError: lastError
  });

  return {
    success: false,
    error: `Failed after ${maxRetries} attempts. Last error: ${lastError}`,
    messageId: messageId,
    timestamp: new Date(),
    lastResult: lastResult
  };
};


export { generateUUID };