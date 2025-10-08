// src/services/openaiService.js
// Migrated to OpenAI Responses API from Chat Completions API

import OpenAI from 'openai'
import httpLogger from './httpLoggerService.js'
import supabaseLogger from './supabaseLoggerService.js'

class OpenAIService {
  constructor() {
    // Configuration
    this.apiKey = import.meta.env.VITE_OPENAI_API_KEY
    this.defaultModel = 'gpt-4o-mini' // Fast, cost-effective
    this.abortController = null

    // Initialize OpenAI client
    this.client = null
    if (this.apiKey) {
      this.client = new OpenAI({
        apiKey: this.apiKey,
        dangerouslyAllowBrowser: true // Required for client-side usage (dev only)
      })
    } else {
      console.error('VITE_OPENAI_API_KEY not found in environment variables')
    }

    // Response tracking for conversation chaining
    this.conversationResponses = new Map() // chatId -> last response ID
  }

  /**
   * Stream response from OpenAI Responses API with incremental updates
   * @param {Array} messages - Conversation history in app format
   * @param {Object} options - Configuration options
   * @returns {AsyncGenerator} Stream of content chunks
   */
  async *streamResponse(messages, options = {}) {
    const {
      model = this.defaultModel,
      temperature = 0.7,
      maxTokens = 2000,
      systemPrompt = null,
      chatId = null // For response chaining
    } = options

    if (!this.client) {
      throw new Error('OpenAI client not initialized. Check API key.')
    }

    // Build request for Responses API
    const { input, instructions, previousResponseId } = this.buildResponseRequest(
      messages,
      systemPrompt,
      chatId
    )

    // Validate files before sending (throws error if invalid)
    try {
      const fileStats = this.validateFilesForAPI(messages)
      if (fileStats.imageCount > 0 || fileStats.pdfCount > 0) {
        httpLogger.createLogEntry('INFO', 'OPENAI_REQUEST',
          'Request includes file attachments', {
            imageCount: fileStats.imageCount,
            pdfCount: fileStats.pdfCount,
            totalPdfSizeMB: (fileStats.totalPdfSize / (1024 * 1024)).toFixed(2)
          })
      }
    } catch (validationError) {
      httpLogger.createLogEntry('ERROR', 'OPENAI_REQUEST',
        'File validation failed', {
          error: validationError.message
        })
      throw validationError
    }

    // Create new abort controller for this request
    this.abortController = new AbortController()

    const requestBody = {
      model,
      input,
      temperature,
      ...(instructions && { instructions }), // Only include if present
      ...(previousResponseId && { previous_response_id: previousResponseId }) // For multi-turn
    }

    // Add max_tokens if specified (Responses API uses different field name)
    if (maxTokens) {
      requestBody.max_output_tokens = maxTokens
    }

    const requestStartTime = Date.now()
    let totalChunks = 0
    let totalContentLength = 0
    let responseId = null

    httpLogger.createLogEntry('INFO', 'OPENAI_REQUEST',
      'Starting OpenAI Responses API streaming request', {
        model,
        hasInstructions: !!instructions,
        hasPreviousResponse: !!previousResponseId,
        temperature,
        maxTokens,
        requestBody: JSON.stringify(requestBody).substring(0, 500) // Log first 500 chars
      })

    // Log to Supabase for persistent debugging
    await supabaseLogger.logOpenAIStream({
      level: 'INFO',
      message: 'Starting OpenAI Responses API streaming request',
      correlationId: `openai-${Date.now()}`,
      requestBody: requestBody,
      metadata: {
        model,
        hasInstructions: !!instructions,
        hasPreviousResponse: !!previousResponseId,
        temperature,
        maxTokens
      }
    }).catch(err => console.warn('Failed to log to Supabase:', err))

    try {
      // Use OpenAI SDK's native streaming with Responses API
      const stream = await this.client.responses.create({
        ...requestBody,
        stream: true
      }, {
        signal: this.abortController.signal
      })

      httpLogger.createLogEntry('INFO', 'OPENAI_STREAM',
        'Stream connection established via SDK', {})

      let lastChunkTime = Date.now()
      const CHUNK_TIMEOUT_MS = 30000 // 30 second timeout between chunks

      // Stream processing using SDK's async iterator
      for await (const chunk of stream) {
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

        lastChunkTime = Date.now()

        // Extract content from SDK response
        // Responses API uses 'output_text' field
        const content = chunk.output?.[0]?.content?.[0]?.text || chunk.delta

        // Store response ID for conversation chaining
        if (chunk.id && !responseId) {
          responseId = chunk.id
        }

        if (content) {
          totalChunks++
          totalContentLength += content.length
          yield content
        }

        // Check for completion
        if (chunk.done || chunk.status === 'completed') {
          httpLogger.createLogEntry('INFO', 'OPENAI_STREAM',
            'Stream marked as completed by API', {
              totalChunks,
              totalContentLength,
              responseId
            })
        }
      }

      // Store response ID for future conversation chaining
      if (responseId && chatId) {
        this.conversationResponses.set(chatId, responseId)
        httpLogger.createLogEntry('DEBUG', 'OPENAI_STREAM',
          'Stored response ID for conversation chaining', {
            chatId,
            responseId
          })
      }

      const streamDuration = Date.now() - requestStartTime
      httpLogger.createLogEntry('INFO', 'OPENAI_STREAM',
        'Stream completed successfully', {
          totalChunks,
          totalContentLength,
          streamDuration,
          responseId,
          avgChunkSize: totalChunks > 0 ? (totalContentLength / totalChunks).toFixed(2) : 0
        })

      // Log successful completion to Supabase
      await supabaseLogger.logOpenAIStream({
        level: 'INFO',
        message: 'OpenAI Responses API stream completed successfully',
        metadata: {
          totalChunks,
          totalContentLength,
          streamDuration,
          responseId,
          avgChunkSize: totalChunks > 0 ? (totalContentLength / totalChunks).toFixed(2) : 0
        }
      }).catch(err => console.warn('Failed to log to Supabase:', err))

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
        'OpenAI Responses API streaming request failed', {
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
        message: 'OpenAI Responses API streaming request failed',
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
   * Build request for OpenAI Responses API
   * Separates instructions (system) from input (user message/context)
   * @param {Array} conversationMessages - App messages
   * @param {String} systemPrompt - System instructions
   * @param {String} chatId - Chat ID for response chaining
   * @returns {Object} { input, instructions, previousResponseId }
   */
  buildResponseRequest(conversationMessages, systemPrompt, chatId) {
    // Get previous response ID for conversation chaining
    const previousResponseId = chatId ? this.conversationResponses.get(chatId) : null

    // Filter out messages that should not be sent
    const validMessages = conversationMessages.filter(msg => {
      // Skip initial AI greeting
      if (msg.content === 'Hello! How can I assist you today?' && msg.type === 'ai') {
        return false
      }
      // Skip streaming messages (placeholders)
      if (msg.isStreaming) {
        return false
      }
      // Skip empty messages without files
      if ((!msg.content || msg.content.trim() === '') &&
          (!msg.fileAttachments || msg.fileAttachments.length === 0)) {
        return false
      }
      return true
    })

    // For Responses API with conversation chaining:
    // - instructions: System prompt (stays constant)
    // - input: Current turn's input (can be text or structured content with files)
    // - previous_response_id: Links to previous response for context

    let input

    // If we have a previous response, we can use simpler input (just the latest user message)
    // Otherwise, we need to provide full context in input
    if (previousResponseId) {
      // Multi-turn with chaining: just send the latest user message
      const latestUserMessage = [...validMessages].reverse().find(msg => msg.type === 'user')

      if (!latestUserMessage) {
        throw new Error('No user message found for input')
      }

      input = this.formatMessageContent(latestUserMessage)
    } else {
      // First turn or no chaining: Build context in input
      // Format as array of role/content objects similar to Chat Completions
      const contextMessages = validMessages.slice(-20).map(msg => ({
        role: msg.type === 'user' ? 'user' : 'assistant',
        content: this.formatMessageContent(msg)
      }))

      // For multi-message context, format as structured input
      if (contextMessages.length === 1) {
        input = contextMessages[0].content
      } else {
        // Multiple messages: create a context structure
        // Note: This is a workaround since Responses API prefers chaining
        input = contextMessages
      }
    }

    return {
      input,
      instructions: systemPrompt || undefined,
      previousResponseId: previousResponseId || undefined
    }
  }

  /**
   * Format message content for Responses API
   * Handles both text-only and multi-content (text + files)
   * @param {Object} message - Message object
   * @returns {String|Array} Formatted content
   */
  formatMessageContent(message) {
    // Check if message has file attachments
    if (message.fileAttachments && message.fileAttachments.length > 0) {
      // Multi-content message (text + files)
      const content = []

      // Add text content if present
      if (message.content && message.content.trim() !== '') {
        content.push({
          type: 'text',
          text: message.content
        })
      }

      // Add file attachments
      for (const file of message.fileAttachments) {
        if (!file.base64) {
          console.warn('File attachment missing base64 data, skipping:', file.file_name)
          continue
        }

        if (file.file_type.startsWith('image/')) {
          // Image attachment
          content.push({
            type: 'image_url',
            image_url: {
              url: file.base64
            }
          })
        } else if (file.file_type === 'application/pdf') {
          // PDF attachment
          content.push({
            type: 'file',
            filename: file.file_name,
            file_data: file.base64
          })
        } else {
          console.warn('Unsupported file type for OpenAI API:', file.file_type)
        }
      }

      return content.length > 0 ? content : message.content
    } else {
      // Text-only message
      return message.content
    }
  }

  /**
   * Clear conversation response history for a chat
   * Useful when starting a new conversation or resetting context
   * @param {String} chatId - Chat ID to clear
   */
  clearConversationHistory(chatId) {
    if (chatId) {
      this.conversationResponses.delete(chatId)
      httpLogger.createLogEntry('DEBUG', 'OPENAI_SERVICE',
        'Cleared conversation response history', { chatId })
    }
  }

  /**
   * Validate files in messages before sending to OpenAI API
   * @param {Array} messages - Messages array to validate
   * @throws {Error} If validation fails
   */
  validateFilesForAPI(messages) {
    let imageCount = 0
    let pdfCount = 0
    let totalPdfSize = 0
    const errors = []

    for (const msg of messages) {
      if (!msg.fileAttachments || msg.fileAttachments.length === 0) {
        continue
      }

      for (const file of msg.fileAttachments) {
        if (file.file_type.startsWith('image/')) {
          imageCount++
          if (imageCount > 10) {
            errors.push('Maximum 10 images per request. Please remove some images.')
          }
        } else if (file.file_type === 'application/pdf') {
          pdfCount++
          totalPdfSize += file.file_size

          if (totalPdfSize > 32 * 1024 * 1024) {
            errors.push('PDF files exceed 32MB total size limit. Please upload smaller PDFs.')
          }
        }
      }
    }

    if (errors.length > 0) {
      throw new Error(errors.join(' '))
    }

    return {
      imageCount,
      pdfCount,
      totalPdfSize
    }
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

  // LEGACY METHOD - Kept for backwards compatibility
  // Redirects to streamResponse
  async *streamChatCompletion(messages, options = {}) {
    console.warn('streamChatCompletion is deprecated. Use streamResponse instead.')
    yield* this.streamResponse(messages, options)
  }

  // LEGACY METHOD - Kept for backwards compatibility
  // Redirects to buildResponseRequest
  buildMessagesArray(conversationMessages, systemPrompt) {
    console.warn('buildMessagesArray is deprecated. Use buildResponseRequest instead.')
    const { input, instructions } = this.buildResponseRequest(conversationMessages, systemPrompt, null)

    // Format as old-style messages array for compatibility
    const messages = []
    if (instructions) {
      messages.push({ role: 'system', content: instructions })
    }
    if (Array.isArray(input)) {
      messages.push(...input)
    } else {
      messages.push({ role: 'user', content: input })
    }
    return messages
  }
}

// Create singleton instance
const openaiService = new OpenAIService()

export default openaiService
export { OpenAIService }
