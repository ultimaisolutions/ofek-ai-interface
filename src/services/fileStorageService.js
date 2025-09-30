import { createClient } from '@supabase/supabase-js'
import { sanitizeUserInput } from './inputSanitizationService'

const supabaseUrl = `https://${import.meta.env.VITE_SUPABASE_PROJECT_REF || 'gijwrusyutuyscbgpwtv'}.supabase.co`
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Configure Supabase client with proper options for anonymous access
const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false
  },
  global: {
    headers: {
      'x-session-id': 'anonymous_session' // Default session for anonymous users
    }
  }
})

const BUCKET_NAME = 'ai-chat-media'
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

class FileStorageService {
  constructor() {
    this.uploadQueue = new Map()
    this.progressCallbacks = new Map()
  }

  async uploadFile(file, messageId, sessionId, onProgress = null) {
    try {
      const fileId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

      if (onProgress) {
        this.progressCallbacks.set(fileId, onProgress)
      }

      const validationResult = this.validateFile(file)
      if (!validationResult.isValid) {
        throw new Error(validationResult.errors.join(', '))
      }

      const sanitizedFileName = sanitizeUserInput(file.name)
      const filePath = `${sessionId}/${messageId}/${fileId}-${sanitizedFileName}`

      onProgress && onProgress(0, 'Preparing upload...')

      let thumbnailUrl = null
      let compressedFile = file

      if (file.type.startsWith('image/')) {
        try {
          const { compressed, thumbnail } = await this.processImage(file)
          compressedFile = compressed || file

          if (thumbnail) {
            const thumbnailPath = `${sessionId}/${messageId}/thumb-${fileId}-${sanitizedFileName}`
            const { error: thumbnailError } = await supabase.storage
              .from(BUCKET_NAME)
              .upload(thumbnailPath, thumbnail)

            if (!thumbnailError) {
              const { data: thumbnailUrlData } = supabase.storage
                .from(BUCKET_NAME)
                .getPublicUrl(thumbnailPath)
              thumbnailUrl = thumbnailUrlData.publicUrl
            }
          }
        } catch (error) {
          console.warn('Image processing failed, uploading original:', error)
        }
      }

      onProgress && onProgress(20, 'Uploading file...')

      const { error } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(filePath, compressedFile, {
          cacheControl: '3600',
          upsert: false,
          onUploadProgress: (progress) => {
            const percentage = Math.round((progress.loaded / progress.total) * 80) + 20
            onProgress && onProgress(percentage, 'Uploading...')
          }
        })

      if (error) {
        console.error('Storage upload error details:', {
          error,
          filePath,
          fileSize: compressedFile.size,
          fileType: compressedFile.type,
          bucketName: BUCKET_NAME
        })
        throw new Error(`Upload failed: ${error.message || 'Unknown storage error'}`)
      }

      const { data: urlData } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(filePath)

      const fileMetadata = {
        id: fileId,
        message_id: messageId,
        file_name: sanitizedFileName,
        file_type: file.type,
        file_size: compressedFile.size,
        storage_path: filePath,
        upload_status: 'completed',
        download_url: urlData.publicUrl,
        thumbnail_url: thumbnailUrl,
        original_size: file.size
      }

      await this.saveFileMetadata(fileMetadata)

      onProgress && onProgress(100, 'Upload complete')
      this.progressCallbacks.delete(fileId)

      return {
        success: true,
        fileId,
        url: urlData.publicUrl,
        thumbnailUrl,
        metadata: fileMetadata
      }

    } catch (error) {
      console.error('File upload error:', error)
      throw error
    }
  }

  async saveFileMetadata(metadata) {
    try {
      console.log('Attempting to save file metadata:', metadata)

      const { error } = await supabase
        .from('file_uploads')
        .insert([metadata])

      if (error) {
        console.error('Database insert error details:', {
          error,
          metadata,
          errorMessage: error.message,
          errorCode: error.code
        })
        throw new Error(`Failed to save file metadata: ${error.message || 'Unknown database error'}`)
      }

      console.log('File metadata saved successfully')
    } catch (error) {
      console.error('Error saving file metadata:', error)
      throw error
    }
  }

  async getFileMetadata(fileId) {
    try {
      const { data, error } = await supabase
        .from('file_uploads')
        .select('*')
        .eq('id', fileId)
        .single()

      if (error) {
        throw new Error(`Failed to get file metadata: ${error.message}`)
      }

      return data
    } catch (error) {
      console.error('Error getting file metadata:', error)
      throw error
    }
  }

  async deleteFile(fileId) {
    try {
      const metadata = await this.getFileMetadata(fileId)

      if (!metadata) {
        throw new Error('File not found')
      }

      const { error: storageError } = await supabase.storage
        .from(BUCKET_NAME)
        .remove([metadata.storage_path])

      if (storageError) {
        console.error('Storage deletion error:', storageError)
      }

      if (metadata.thumbnail_url) {
        const thumbnailPath = metadata.storage_path.replace(/^/, 'thumb-')
        await supabase.storage
          .from(BUCKET_NAME)
          .remove([thumbnailPath])
      }

      const { error: dbError } = await supabase
        .from('file_uploads')
        .delete()
        .eq('id', fileId)

      if (dbError) {
        throw new Error(`Failed to delete file metadata: ${dbError.message}`)
      }

      return { success: true }

    } catch (error) {
      console.error('File deletion error:', error)
      throw error
    }
  }

  async downloadFile(fileId) {
    try {
      const metadata = await this.getFileMetadata(fileId)

      if (!metadata) {
        throw new Error('File not found')
      }

      const { data, error } = await supabase.storage
        .from(BUCKET_NAME)
        .download(metadata.storage_path)

      if (error) {
        throw new Error(`Download failed: ${error.message}`)
      }

      return {
        blob: data,
        metadata: metadata
      }

    } catch (error) {
      console.error('File download error:', error)
      throw error
    }
  }

  validateFile(file) {
    const errors = []

    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'application/rtf',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'audio/mpeg',
      'audio/wav',
      'video/mp4',
      'video/avi',
      'video/quicktime',
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/svg+xml'
    ]

    if (!allowedTypes.includes(file.type)) {
      errors.push(`File type "${file.type}" is not supported`)
    }

    if (file.size > MAX_FILE_SIZE) {
      const sizeMB = (MAX_FILE_SIZE / (1024 * 1024)).toFixed(1)
      errors.push(`File size exceeds ${sizeMB}MB limit`)
    }

    if (file.size === 0) {
      errors.push('File is empty')
    }

    const fileName = file.name
    const dangerousPatterns = [
      /\.exe$/i, /\.bat$/i, /\.cmd$/i, /\.scr$/i, /\.vbs$/i, /\.js$/i,
      /\.\./,
      /[<>:"|?*]/,
    ]

    for (const pattern of dangerousPatterns) {
      if (pattern.test(fileName)) {
        errors.push('File name contains invalid characters or extension')
        break
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    }
  }

  async processImage(file) {
    return new Promise((resolve) => {
      if (!file.type.startsWith('image/')) {
        resolve({ compressed: null, thumbnail: null })
        return
      }

      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      const img = new Image()

      img.onload = () => {
        try {
          const MAX_WIDTH = 1920
          const MAX_HEIGHT = 1080
          const THUMB_SIZE = 200

          let { width, height } = img

          if (width > MAX_WIDTH || height > MAX_HEIGHT) {
            if (width > height) {
              height = (height * MAX_WIDTH) / width
              width = MAX_WIDTH
            } else {
              width = (width * MAX_HEIGHT) / height
              height = MAX_HEIGHT
            }
          }

          canvas.width = width
          canvas.height = height
          ctx.drawImage(img, 0, 0, width, height)

          canvas.toBlob((compressedBlob) => {
            const thumbCanvas = document.createElement('canvas')
            const thumbCtx = thumbCanvas.getContext('2d')
            thumbCanvas.width = THUMB_SIZE
            thumbCanvas.height = THUMB_SIZE

            const size = Math.min(img.width, img.height)
            const x = (img.width - size) / 2
            const y = (img.height - size) / 2

            thumbCtx.drawImage(img, x, y, size, size, 0, 0, THUMB_SIZE, THUMB_SIZE)

            thumbCanvas.toBlob((thumbnailBlob) => {
              resolve({
                compressed: compressedBlob,
                thumbnail: thumbnailBlob
              })
            }, 'image/jpeg', 0.7)
          }, 'image/jpeg', 0.8)

        } catch (error) {
          console.error('Image processing error:', error)
          resolve({ compressed: null, thumbnail: null })
        }
      }

      img.onerror = () => {
        resolve({ compressed: null, thumbnail: null })
      }

      img.src = URL.createObjectURL(file)
    })
  }

  async getFilesByMessage(messageId) {
    try {
      const { data, error } = await supabase
        .from('file_uploads')
        .select('*')
        .eq('message_id', messageId)

      if (error) {
        throw new Error(`Failed to get files: ${error.message}`)
      }

      return data || []
    } catch (error) {
      console.error('Error getting files by message:', error)
      return []
    }
  }

  getProgressCallback(fileId) {
    return this.progressCallbacks.get(fileId)
  }
}

const fileStorageService = new FileStorageService()
export default fileStorageService