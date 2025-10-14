// src/services/n8nFileProcessorService.js
// Service for processing uploaded files via n8n endpoint to extract descriptions

import httpLogger from './httpLoggerService.js'

class N8nFileProcessorService {
  constructor() {
    this.n8nEndpoint = 'https://ultimaisolutions.app.n8n.cloud/webhook/interface-files'
    this.maxRetries = 3
    this.timeoutMs = 30000 // 30 seconds per file
  }

  /**
   * Process a single file through n8n to get its description
   * @param {Object} fileMetadata - File metadata from Supabase upload
   * @param {string} sessionId - Session ID for tracking
   * @returns {Promise<Object>} { success, description, fileType, error }
   */
  async processFile(fileMetadata, sessionId) {
    const { download_url, file_name, file_type, file_size, id: fileId } = fileMetadata

    if (!download_url) {
      return {
        success: false,
        error: 'File URL missing',
        fileType: file_type
      }
    }

    httpLogger.createLogEntry('INFO', 'N8N_FILE_PROCESS',
      'Starting file processing via n8n', {
        fileName: file_name,
        fileType: file_type,
        fileSize: file_size,
        fileId
      })

    let lastError = null

    // Retry loop with exponential backoff
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this.makeRequest(download_url, file_name, file_type, file_size, fileId, sessionId, attempt)

        if (result.success) {
          httpLogger.createLogEntry('INFO', 'N8N_FILE_PROCESS',
            'File processing successful', {
              fileName: file_name,
              attempt,
              descriptionLength: result.description?.length || 0
            })

          return result
        }

        lastError = result.error
        httpLogger.createLogEntry('WARN', 'N8N_FILE_PROCESS',
          `File processing failed on attempt ${attempt}`, {
            fileName: file_name,
            attempt,
            error: result.error
          })

      } catch (error) {
        lastError = error.message
        httpLogger.createLogEntry('ERROR', 'N8N_FILE_PROCESS',
          `File processing error on attempt ${attempt}`, {
            fileName: file_name,
            attempt,
            error: error.message,
            stack: error.stack
          })
      }

      // Wait before retry (exponential backoff: 1s, 2s, 4s)
      if (attempt < this.maxRetries) {
        const delay = Math.pow(2, attempt - 1) * 1000
        await this.sleep(delay)
      }
    }

    // All retries failed
    return {
      success: false,
      error: lastError || 'Unknown error',
      fileType: file_type
    }
  }

  /**
   * Make HTTP request to n8n endpoint
   * @private
   */
  async makeRequest(fileUrl, fileName, fileType, fileSize, fileId, sessionId, attempt) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const params = new URLSearchParams({
        fileUrl,
        fileName,
        fileType,
        fileSize: fileSize.toString(),
        fileId,
        sessionId,
        attempt: attempt.toString()
      })

      const url = `${this.n8nEndpoint}?${params.toString()}`

      httpLogger.createLogEntry('DEBUG', 'N8N_FILE_PROCESS',
        'Making request to n8n', {
          url: url.substring(0, 100) + '...',
          attempt
        })

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        },
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`HTTP ${response.status}: ${errorText}`)
      }

      const data = await response.json()

      // Validate response structure
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid response format from n8n')
      }

      // Check if n8n returned an error
      if (data.error) {
        return {
          success: false,
          error: data.error,
          fileType
        }
      }

      // Extract description from response
      const description = data.description || data.content || ''

      if (!description || description.trim() === '') {
        return {
          success: false,
          error: 'Empty description returned',
          fileType
        }
      }

      return {
        success: true,
        description: description.trim(),
        fileType: data.fileType || fileType
      }

    } catch (error) {
      clearTimeout(timeoutId)

      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${this.timeoutMs}ms`)
      }

      throw error
    }
  }

  /**
   * Process multiple files in parallel
   * @param {Array<Object>} fileMetadataArray - Array of file metadata from Supabase
   * @param {string} sessionId - Session ID for tracking
   * @returns {Promise<Array<Object>>} Array of results with descriptions
   */
  async processMultipleFiles(fileMetadataArray, sessionId) {
    httpLogger.createLogEntry('INFO', 'N8N_FILE_PROCESS',
      'Processing multiple files in parallel', {
        fileCount: fileMetadataArray.length
      })

    const promises = fileMetadataArray.map(fileMetadata =>
      this.processFile(fileMetadata, sessionId)
    )

    const results = await Promise.all(promises)

    const successCount = results.filter(r => r.success).length
    const failureCount = results.length - successCount

    httpLogger.createLogEntry('INFO', 'N8N_FILE_PROCESS',
      'Batch file processing complete', {
        total: results.length,
        successful: successCount,
        failed: failureCount
      })

    return results
  }

  /**
   * Format file descriptions for inclusion in user message
   * @param {Array<Object>} processedFiles - Results from processMultipleFiles
   * @param {Array<Object>} originalFiles - Original file metadata
   * @returns {string} Formatted description text
   */
  formatFileDescriptions(processedFiles, originalFiles) {
    if (!processedFiles || processedFiles.length === 0) {
      return ''
    }

    const descriptions = []

    processedFiles.forEach((result, index) => {
      const file = originalFiles[index]
      const fileName = file?.file_name || 'Unknown file'
      const fileType = file?.file_type || 'unknown'

      if (result.success && result.description) {
        descriptions.push(
          `\n\n[Attached file: ${fileName} (${fileType})]\n` +
          `File content: ${result.description}`
        )
      } else if (!result.success) {
        // Note failed processing but don't block the message
        descriptions.push(
          `\n\n[Attached file: ${fileName} (${fileType})]\n` +
          `Note: Unable to process this file. Error: ${result.error || 'Unknown error'}`
        )
      }
    })

    return descriptions.join('')
  }

  /**
   * Sleep utility for retry delays
   * @private
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Check if file type should be processed via n8n
   * Images and PDFs are handled directly by OpenAI, others go through n8n
   * @param {string} fileType - MIME type
   * @returns {boolean}
   */
  shouldProcessViaN8n(fileType) {
    // Images and PDFs are sent directly to OpenAI with base64
    // All other file types should be processed via n8n for text extraction
    const directTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf'
    ]

    return !directTypes.includes(fileType)
  }
}

// Create singleton instance
const n8nFileProcessorService = new N8nFileProcessorService()
export default n8nFileProcessorService
