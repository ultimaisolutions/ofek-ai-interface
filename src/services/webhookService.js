// Simple UUID v4 generation function
const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

// Webhook service for sending message data with response correlation
export const sendMessageToWebhook = async (message, options = {}) => {
  const webhookUrl = 'https://ultimaisolutions.app.n8n.cloud/webhook-test/interface-chat';

  // Generate unique message ID if not provided
  const messageId = message.id || generateUUID();

  // Prepare query parameters with response correlation
  const params = new URLSearchParams({
    messageType: message.type || 'text',
    content: message.content || '',
    timestamp: message.timestamp ? message.timestamp.toISOString() : new Date().toISOString(),
    messageId: messageId.toString(),
    expectResponse: options.expectResponse !== false ? 'true' : 'false',
    responseFormat: options.responseFormat || 'json',
    userId: options.userId || 'anonymous',
    sessionId: options.sessionId || generateSessionId()
  });

  const requestUrl = `${webhookUrl}?${params.toString()}`;

  console.log('Sending webhook request to:', requestUrl);
  console.log('Message ID for correlation:', messageId);

  try {
    // Send GET request to webhook (no custom headers to avoid CORS preflight)
    const response = await fetch(requestUrl, {
      method: 'GET'
    });

    if (!response.ok) {
      throw new Error(`Webhook request failed: ${response.status} ${response.statusText}`);
    }

    // Return response data if available
    const data = await response.text();

    // Check if this is an immediate response or acknowledgment
    let parsedData = null;
    let isAcknowledgment = false;

    try {
      parsedData = JSON.parse(data);
      isAcknowledgment = parsedData.status === 'acknowledged' || parsedData.type === 'acknowledgment';
    } catch {
      // Plain text response
      parsedData = { content: data };
    }

    return {
      success: true,
      data: parsedData,
      rawData: data,
      messageId: messageId,
      isAcknowledgment: isAcknowledgment,
      timestamp: new Date(),
      requestUrl: requestUrl
    };

  } catch (error) {
    console.error('Webhook request failed:', error);
    console.error('Request URL was:', requestUrl);

    // Return error details
    return {
      success: false,
      error: error.message,
      messageId: messageId,
      requestUrl: requestUrl,
      timestamp: new Date()
    };
  }
};

// Generate session ID for tracking conversation context
const generateSessionId = () => {
  const sessionId = sessionStorage.getItem('ai-chat-session-id');
  if (sessionId) {
    return sessionId;
  }

  const newSessionId = generateUUID();
  sessionStorage.setItem('ai-chat-session-id', newSessionId);
  return newSessionId;
};

// Retry logic with exponential backoff
export const sendMessageToWebhookWithRetry = async (message, options = {}, maxRetries = 3, baseDelay = 1000) => {
  let lastError;
  let lastResult;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await sendMessageToWebhook(message, options);

      if (result.success) {
        return result;
      }

      lastError = result.error;
      lastResult = result;

      // Don't retry on the last attempt
      if (attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.log(`Webhook retry ${attempt + 1}/${maxRetries} in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

    } catch (error) {
      lastError = error.message;

      // Don't retry on the last attempt
      if (attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.log(`Webhook retry ${attempt + 1}/${maxRetries} in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  return {
    success: false,
    error: `Failed after ${maxRetries} attempts. Last error: ${lastError}`,
    messageId: message.id || generateUUID(),
    timestamp: new Date(),
    lastResult: lastResult
  };
};

// Utility function to check webhook health
export const checkWebhookHealth = async () => {
  const healthUrl = 'https://ultimaisolutions.app.n8n.cloud/webhook-test/interface-chat/health';

  try {
    const response = await fetch(healthUrl, {
      method: 'GET'
    });

    return {
      isHealthy: response.ok,
      status: response.status,
      statusText: response.statusText,
      timestamp: new Date()
    };
  } catch (error) {
    return {
      isHealthy: false,
      error: error.message,
      timestamp: new Date()
    };
  }
};

export { generateUUID };