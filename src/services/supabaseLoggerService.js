// Supabase Logger Service - Persistent database logging for debugging
// Extends httpLoggerService with Supabase persistence

import supabase from '../lib/supabaseClient'
import httpLogger from './httpLoggerService'

class SupabaseLoggerService {
  constructor() {
    this.batchQueue = []
    this.batchSize = 10 // Write after 10 logs
    this.batchInterval = 5000 // Or after 5 seconds
    this.batchTimer = null
    this.isEnabled = true
    this.currentUserId = null
    this.currentSessionId = null
  }

  /**
   * Initialize the logger with user context
   * @param {string} userId - Current user ID
   * @param {string} sessionId - Current session ID
   */
  initialize(userId, sessionId) {
    this.currentUserId = userId
    this.currentSessionId = sessionId

    httpLogger.createLogEntry('INFO', 'SUPABASE_LOGGER',
      'Supabase logger initialized', {
        userId,
        sessionId
      })
  }

  /**
   * Log an HTTP request/response to Supabase
   * @param {Object} logData - Log entry data
   */
  async logHttpRequest(logData) {
    if (!this.isEnabled || !this.currentUserId) {
      return // Skip if disabled or no user
    }

    const entry = {
      user_id: this.currentUserId,
      session_id: this.currentSessionId,
      log_level: logData.level || 'INFO',
      category: logData.category || 'HTTP_REQUEST',
      message: logData.message || '',
      correlation_id: logData.correlationId || null,
      request_method: logData.method || null,
      request_url: logData.url || null,
      request_headers: logData.requestHeaders || null,
      request_body: logData.requestBody || null,
      response_status: logData.responseStatus || null,
      response_headers: logData.responseHeaders || null,
      response_body: logData.responseBody ? String(logData.responseBody).substring(0, 10000) : null, // Limit to 10KB
      error_message: logData.error || null,
      error_stack: logData.stack || null,
      metadata: logData.metadata || {}
    }

    // Add to batch queue
    this.batchQueue.push(entry)

    // Check if we should flush
    if (this.batchQueue.length >= this.batchSize) {
      await this.flushBatch()
    } else {
      // Schedule flush if not already scheduled
      this.scheduleBatchFlush()
    }
  }

  /**
   * Log OpenAI streaming request/response
   * @param {Object} streamData - Stream metadata
   */
  async logOpenAIStream(streamData) {
    if (!this.isEnabled || !this.currentUserId) {
      return
    }

    const entry = {
      user_id: this.currentUserId,
      session_id: this.currentSessionId,
      log_level: streamData.level || 'INFO',
      category: 'OPENAI_STREAM',
      message: streamData.message || 'OpenAI stream event',
      correlation_id: streamData.correlationId || null,
      request_method: 'POST',
      request_url: 'https://api.openai.com/v1/chat/completions',
      request_body: streamData.requestBody || null,
      response_body: streamData.responseContent || null,
      error_message: streamData.error || null,
      error_stack: streamData.stack || null,
      metadata: {
        model: streamData.model || 'gpt-4o-mini',
        messageId: streamData.messageId || null,
        chunkCount: streamData.chunkCount || 0,
        totalContentLength: streamData.totalContentLength || 0,
        streamDuration: streamData.streamDuration || 0,
        ...streamData.metadata || {}
      }
    }

    this.batchQueue.push(entry)

    if (this.batchQueue.length >= this.batchSize) {
      await this.flushBatch()
    } else {
      this.scheduleBatchFlush()
    }
  }

  /**
   * Log a generic application event
   * @param {string} level - Log level
   * @param {string} category - Event category
   * @param {string} message - Log message
   * @param {Object} metadata - Additional context
   */
  async logEvent(level, category, message, metadata = {}) {
    if (!this.isEnabled || !this.currentUserId) {
      return
    }

    const entry = {
      user_id: this.currentUserId,
      session_id: this.currentSessionId,
      log_level: level,
      category,
      message,
      correlation_id: metadata.correlationId || null,
      metadata
    }

    this.batchQueue.push(entry)

    // For errors, flush immediately
    if (level === 'ERROR') {
      await this.flushBatch()
    } else if (this.batchQueue.length >= this.batchSize) {
      await this.flushBatch()
    } else {
      this.scheduleBatchFlush()
    }
  }

  /**
   * Schedule a batch flush
   */
  scheduleBatchFlush() {
    if (this.batchTimer) {
      return // Already scheduled
    }

    this.batchTimer = setTimeout(() => {
      this.flushBatch()
    }, this.batchInterval)
  }

  /**
   * Flush the batch queue to Supabase
   */
  async flushBatch() {
    // Clear timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }

    if (this.batchQueue.length === 0) {
      return
    }

    // Take current batch and clear queue
    const batch = [...this.batchQueue]
    this.batchQueue = []

    try {
      const { data, error } = await supabase
        .from('http_logs')
        .insert(batch)

      if (error) {
        console.error('Failed to write logs to Supabase:', error)
        httpLogger.createLogEntry('ERROR', 'SUPABASE_LOGGER',
          'Failed to write batch to database', {
            error: error.message,
            batchSize: batch.length
          })

        // Put failed logs back in queue for retry
        this.batchQueue.unshift(...batch)
      } else {
        httpLogger.createLogEntry('DEBUG', 'SUPABASE_LOGGER',
          `Successfully wrote ${batch.length} logs to database`, {
            batchSize: batch.length
          })
      }
    } catch (error) {
      console.error('Error flushing log batch:', error)
      httpLogger.createLogEntry('ERROR', 'SUPABASE_LOGGER',
        'Exception while flushing batch', {
          error: error.message,
          stack: error.stack,
          batchSize: batch.length
        })

      // Put failed logs back in queue
      this.batchQueue.unshift(...batch)
    }
  }

  /**
   * Query logs from Supabase
   * @param {Object} filters - Query filters
   * @returns {Promise<Array>} Log entries
   */
  async queryLogs(filters = {}) {
    const {
      correlationId,
      category,
      level,
      startTime,
      endTime,
      limit = 100
    } = filters

    try {
      let query = supabase
        .from('http_logs')
        .select('*')
        .eq('user_id', this.currentUserId)
        .order('created_at', { ascending: false })
        .limit(limit)

      if (correlationId) {
        query = query.eq('correlation_id', correlationId)
      }

      if (category) {
        query = query.eq('category', category)
      }

      if (level) {
        query = query.eq('log_level', level)
      }

      if (startTime) {
        query = query.gte('created_at', startTime)
      }

      if (endTime) {
        query = query.lte('created_at', endTime)
      }

      const { data, error } = await query

      if (error) {
        console.error('Failed to query logs:', error)
        return []
      }

      return data || []
    } catch (error) {
      console.error('Error querying logs:', error)
      return []
    }
  }

  /**
   * Get logs for a specific correlation ID (trace a request)
   * @param {string} correlationId - Correlation ID to trace
   * @returns {Promise<Array>} Related log entries
   */
  async traceLogs(correlationId) {
    return this.queryLogs({ correlationId, limit: 1000 })
  }

  /**
   * Clean up old logs (data retention)
   * @param {number} daysToKeep - Number of days to retain logs
   */
  async cleanupOldLogs(daysToKeep = 7) {
    try {
      const cutoffDate = new Date()
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep)

      const { data, error } = await supabase
        .from('http_logs')
        .delete()
        .eq('user_id', this.currentUserId)
        .lt('created_at', cutoffDate.toISOString())

      if (error) {
        console.error('Failed to cleanup old logs:', error)
        return { success: false, error }
      }

      httpLogger.createLogEntry('INFO', 'SUPABASE_LOGGER',
        'Cleaned up old logs', {
          daysToKeep,
          cutoffDate: cutoffDate.toISOString()
        })

      return { success: true, data }
    } catch (error) {
      console.error('Error cleaning up logs:', error)
      return { success: false, error }
    }
  }

  /**
   * Enable or disable logging
   * @param {boolean} enabled - Enable state
   */
  setEnabled(enabled) {
    this.isEnabled = enabled
    httpLogger.createLogEntry('INFO', 'SUPABASE_LOGGER',
      `Logging ${enabled ? 'enabled' : 'disabled'}`, {})
  }

  /**
   * Force flush on app shutdown or logout
   */
  async shutdown() {
    await this.flushBatch()
    this.currentUserId = null
    this.currentSessionId = null
  }
}

// Create singleton instance
const supabaseLogger = new SupabaseLoggerService()

// Expose to window for debugging
if (typeof window !== 'undefined') {
  window.supabaseLogger = supabaseLogger
}

export default supabaseLogger
export { SupabaseLoggerService }
