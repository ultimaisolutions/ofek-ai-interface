// src/services/openaiService.js

import httpLogger from './httpLoggerService.js'
import supabaseLogger from './supabaseLoggerService.js'

class OpenAIService {
  constructor() {
    // Configuration
    this.apiKey = import.meta.env.VITE_OPENAI_API_KEY
    this.baseUrl = 'https://api.openai.com/v1'
    this.defaultModel = 'gpt-4o-mini' // Fast, cost-effective
    this.abortController = null

    // Validate API key on initialization
    if (!this.apiKey) {
      console.error('VITE_OPENAI_API_KEY not found in environment variables')
    }
  }

  /**
   * Stream chat completion with incremental updates
   * @param {Array} messages - Conversation history in OpenAI format
   * @param {Object} options - Configuration options
   * @returns {AsyncGenerator} Stream of content chunks
   */
  async *streamChatCompletion(messages, options = {}) {
    const {
      model = this.defaultModel,
      temperature = 0.7,
      maxTokens = 2000,
      systemPrompt = null
    } = options

    // Build messages array
    const apiMessages = this.buildMessagesArray(messages, systemPrompt)

    // Create new abort controller for this request
    this.abortController = new AbortController()

    const requestBody = {
      model,
      messages: apiMessages,
      stream: true,
      temperature,
      max_tokens: maxTokens
    }

    const requestStartTime = Date.now()
    let totalChunks = 0
    let totalContentLength = 0

    httpLogger.createLogEntry('INFO', 'OPENAI_REQUEST',
      'Starting OpenAI streaming request', {
        model,
        messageCount: apiMessages.length,
        temperature,
        maxTokens,
        requestBody: JSON.stringify(requestBody).substring(0, 500) // Log first 500 chars
      })

    // Log to Supabase for persistent debugging
    await supabaseLogger.logOpenAIStream({
      level: 'INFO',
      message: 'Starting OpenAI streaming request',
      correlationId: `openai-${Date.now()}`,
      requestBody: requestBody,
      metadata: {
        model,
        messageCount: apiMessages.length,
        temperature,
        maxTokens
      }
    }).catch(err => console.warn('Failed to log to Supabase:', err))

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(requestBody),
        signal: this.abortController.signal
      })

      if (!response.ok) {
        const errorData = await response.json()
        const errorMessage = `OpenAI API Error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`

        httpLogger.createLogEntry('ERROR', 'OPENAI_REQUEST',
          'OpenAI API returned error status', {
            status: response.status,
            statusText: response.statusText,
            errorData,
            requestDuration: Date.now() - requestStartTime
          })

        throw new Error(errorMessage)
      }

      httpLogger.createLogEntry('INFO', 'OPENAI_STREAM',
        'Stream connection established', {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries())
        })

      // Stream processing with interruption detection
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let lastChunkTime = Date.now()
      const CHUNK_TIMEOUT_MS = 30000 // 30 second timeout between chunks

      while (true) {
        // CRITICAL: Detect stream stalls
        const timeSinceLastChunk = Date.now() - lastChunkTime
        if (timeSinceLastChunk > CHUNK_TIMEOUT_MS) {
          httpLogger.createLogEntry('ERROR', 'OPENAI_STREAM',
            'Stream stalled - no chunks received in timeout period', {
              timeoutMs: CHUNK_TIMEOUT_MS,
              timeSinceLastChunk,
              totalChunks,
              totalContentLength
            })
          throw new Error(`Stream stalled: No data received for ${CHUNK_TIMEOUT_MS}ms`)
        }

        const { done, value } = await reader.read()

        if (done) {
          const streamDuration = Date.now() - requestStartTime
          httpLogger.createLogEntry('INFO', 'OPENAI_STREAM',
            'Stream completed successfully', {
              totalChunks,
              totalContentLength,
              streamDuration,
              avgChunkSize: totalChunks > 0 ? (totalContentLength / totalChunks).toFixed(2) : 0
            })

          // Log successful completion to Supabase
          await supabaseLogger.logOpenAIStream({
            level: 'INFO',
            message: 'OpenAI stream completed successfully',
            metadata: {
              totalChunks,
              totalContentLength,
              streamDuration,
              avgChunkSize: totalChunks > 0 ? (totalContentLength / totalChunks).toFixed(2) : 0
            }
          }).catch(err => console.warn('Failed to log to Supabase:', err))

          break
        }

        lastChunkTime = Date.now()
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() // Keep incomplete line in buffer

        for (const line of lines) {
          const trimmed = line.trim()

          // Skip empty lines and comments
          if (!trimmed || trimmed.startsWith(':')) continue

          // Check for stream end
          if (trimmed === 'data: [DONE]') {
            httpLogger.createLogEntry('DEBUG', 'OPENAI_STREAM',
              'Received [DONE] marker', { totalChunks })
            continue
          }

          // Parse SSE data
          if (trimmed.startsWith('data: ')) {
            const jsonStr = trimmed.substring(6)

            try {
              const parsed = JSON.parse(jsonStr)
              const content = parsed.choices[0]?.delta?.content

              if (content) {
                totalChunks++
                totalContentLength += content.length
                yield content
              }

              // Check for finish reason
              if (parsed.choices[0]?.finish_reason) {
                httpLogger.createLogEntry('INFO', 'OPENAI_STREAM',
                  `Stream finished with reason: ${parsed.choices[0].finish_reason}`, {
                    totalChunks,
                    totalContentLength,
                    finishReason: parsed.choices[0].finish_reason
                  })
              }
            } catch (parseError) {
              httpLogger.createLogEntry('WARN', 'OPENAI_STREAM',
                'Failed to parse SSE chunk', {
                  error: parseError.message,
                  rawChunk: jsonStr.substring(0, 200)
                })
            }
          }
        }
      }

    } catch (error) {
      const requestDuration = Date.now() - requestStartTime

      if (error.name === 'AbortError') {
        httpLogger.createLogEntry('INFO', 'OPENAI_STREAM',
          'Stream aborted by user', {
            requestDuration,
            totalChunks,
            totalContentLength
          })
        throw new Error('Request cancelled')
      }

      httpLogger.createLogEntry('ERROR', 'OPENAI_REQUEST',
        'OpenAI streaming request failed', {
          error: error.message,
          stack: error.stack,
          requestDuration,
          totalChunks,
          totalContentLength,
          hadPartialContent: totalContentLength > 0
        })

      // Log error to Supabase for debugging
      await supabaseLogger.logOpenAIStream({
        level: 'ERROR',
        message: 'OpenAI streaming request failed',
        error: error.message,
        stack: error.stack,
        metadata: {
          requestDuration,
          totalChunks,
          totalContentLength,
          hadPartialContent: totalContentLength > 0
        }
      }).catch(err => console.warn('Failed to log error to Supabase:', err))

      throw error
    } finally {
      this.abortController = null

      httpLogger.createLogEntry('DEBUG', 'OPENAI_STREAM',
        'Stream cleanup - abort controller cleared', {
          totalChunks,
          totalContentLength
        })
    }
  }

  /**
   * Build messages array for OpenAI API
   * @param {Array} conversationMessages - App messages
   * @param {String} systemPrompt - Optional system prompt
   * @returns {Array} OpenAI formatted messages
   */
  buildMessagesArray(conversationMessages, systemPrompt) {
    const messages = []

    // Add system prompt if provided
    if (systemPrompt) {
      messages.push({
        role: 'system',
        content: systemPrompt
      })
    }

    // Convert app messages to OpenAI format
    // Only include last N messages to stay within context window
    const recentMessages = conversationMessages.slice(-20)

    for (const msg of recentMessages) {
      // Skip messages that should not be sent to OpenAI:
      // 1. Initial AI greeting
      if (msg.content === 'Hello! How can I assist you today?' && msg.type === 'ai') {
        continue
      }

      // 2. Streaming messages (placeholders with no content yet)
      if (msg.isStreaming) {
        continue
      }

      // 3. Messages with empty content
      if (!msg.content || msg.content.trim() === '') {
        continue
      }

      messages.push({
        role: msg.type === 'user' ? 'user' : 'assistant',
        content: msg.content
      })
    }

    return messages
  }

  /**
   * Cancel ongoing request
   */
  cancelRequest() {
    if (this.abortController) {
      httpLogger.createLogEntry('INFO', 'OPENAI_STREAM',
        'Cancelling ongoing request', {})
      this.abortController.abort()
    }
  }

  /**
   * Validate API key format
   * @returns {Boolean} true if valid format
   */
  validateApiKey() {
    if (!this.apiKey) return false

    // OpenAI keys start with 'sk-'
    return this.apiKey.startsWith('sk-')
  }

  /**
   * Estimate token count (rough approximation)
   * @param {String} text - Text to count
   * @returns {Number} Approximate token count
   */
  estimateTokens(text) {
    // Rough estimate: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4)
  }
}

// Create singleton instance
const openaiService = new OpenAIService()

export default openaiService
export { OpenAIService }
