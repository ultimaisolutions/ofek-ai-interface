import { useState, useRef, useCallback } from 'react'
import './FileUpload.css'

const FileUpload = ({ onFilesSelected, disabled = false, maxFiles = 5, maxSizeBytes = 10 * 1024 * 1024 }) => {
  const [isDragOver, setIsDragOver] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState([])
  const fileInputRef = useRef(null)

  // Supported file types as per requirements
  const supportedTypes = {
    // Documents
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'text/plain': '.txt',
    'application/rtf': '.rtf',
    // Spreadsheets
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'text/csv': '.csv',
    // Media
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'video/mp4': '.mp4',
    'video/avi': '.avi',
    'video/quicktime': '.mov',
    // Images
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg'
  }

  const validateFile = (file) => {
    const errors = []

    // Check file type
    if (!supportedTypes[file.type]) {
      errors.push(`File type "${file.type}" is not supported`)
    }

    // Check file size
    if (file.size > maxSizeBytes) {
      const sizeMB = (maxSizeBytes / (1024 * 1024)).toFixed(1)
      errors.push(`File size exceeds ${sizeMB}MB limit`)
    }

    // Check file name for security
    const fileName = file.name
    const dangerousPatterns = [
      /\.exe$/i, /\.bat$/i, /\.cmd$/i, /\.scr$/i, /\.vbs$/i, /\.js$/i,
      /\.\./,    // Path traversal
      /[<>:"|?*]/, // Invalid filename characters
    ]

    for (const pattern of dangerousPatterns) {
      if (pattern.test(fileName)) {
        errors.push(`File name contains invalid characters or extension`)
        break
      }
    }

    return errors
  }

  const processFiles = useCallback((files) => {
    const fileArray = Array.from(files)
    const validFiles = []
    const errors = []

    // Check total file count
    if (selectedFiles.length + fileArray.length > maxFiles) {
      errors.push(`Maximum ${maxFiles} files allowed`)
      return { validFiles: [], errors }
    }

    fileArray.forEach((file, index) => {
      const fileErrors = validateFile(file)
      if (fileErrors.length > 0) {
        errors.push(`${file.name}: ${fileErrors.join(', ')}`)
      } else {
        validFiles.push({
          id: `${Date.now()}-${index}`,
          file,
          name: file.name,
          size: file.size,
          type: file.type,
          status: 'selected'
        })
      }
    })

    return { validFiles, errors }
  }, [selectedFiles.length, maxFiles])

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    if (!disabled) {
      setIsDragOver(true)
    }
  }, [disabled])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    if (disabled) return

    const files = e.dataTransfer.files
    const { validFiles, errors } = processFiles(files)

    if (validFiles.length > 0) {
      setSelectedFiles(prev => [...prev, ...validFiles])
      onFilesSelected(validFiles, errors)
    } else if (errors.length > 0) {
      onFilesSelected([], errors)
    }
  }, [disabled, processFiles, onFilesSelected])

  const handleFileInputChange = useCallback((e) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    const { validFiles, errors } = processFiles(files)

    if (validFiles.length > 0) {
      setSelectedFiles(prev => [...prev, ...validFiles])
      onFilesSelected(validFiles, errors)
    } else if (errors.length > 0) {
      onFilesSelected([], errors)
    }

    // Reset input to allow selecting the same file again
    e.target.value = ''
  }, [processFiles, onFilesSelected])

  const removeFile = useCallback((fileId) => {
    setSelectedFiles(prev => {
      const updated = prev.filter(f => f.id !== fileId)
      // Notify parent of removal
      onFilesSelected([], [], fileId)
      return updated
    })
  }, [onFilesSelected])

  const openFileDialog = useCallback(() => {
    if (!disabled && fileInputRef.current) {
      fileInputRef.current.click()
    }
  }, [disabled])

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const getFileIcon = (fileType) => {
    if (fileType.startsWith('image/')) return '🖼️'
    if (fileType.startsWith('video/')) return '🎥'
    if (fileType.startsWith('audio/')) return '🎵'
    if (fileType.includes('pdf')) return '📄'
    if (fileType.includes('word') || fileType.includes('document')) return '📝'
    if (fileType.includes('sheet') || fileType.includes('excel') || fileType.includes('csv')) return '📊'
    return '📎'
  }

  return (
    <div className="file-upload-container">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={Object.keys(supportedTypes).join(',')}
        onChange={handleFileInputChange}
        style={{ display: 'none' }}
        disabled={disabled}
      />

      {/* Drop zone */}
      <div
        className={`file-drop-zone ${isDragOver ? 'drag-over' : ''} ${disabled ? 'disabled' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={openFileDialog}
      >
        <div className="drop-zone-content">
          <div className="drop-zone-icon">📎</div>
          <div className="drop-zone-text">
            <div className="primary-text">
              {isDragOver ? 'Drop files here' : 'Click to select files or drag and drop'}
            </div>
            <div className="secondary-text">
              Supports: PDF, DOC, Excel, Images, Audio, Video • Max {formatFileSize(maxSizeBytes)} per file
            </div>
          </div>
        </div>
      </div>

      {/* Selected files list */}
      {selectedFiles.length > 0 && (
        <div className="selected-files-list">
          <div className="selected-files-header">
            Selected Files ({selectedFiles.length}/{maxFiles})
          </div>
          {selectedFiles.map((fileItem) => (
            <div key={fileItem.id} className={`file-item ${fileItem.status}`}>
              <div className="file-info">
                <span className="file-icon">{getFileIcon(fileItem.type)}</span>
                <div className="file-details">
                  <div className="file-name" title={fileItem.name}>
                    {fileItem.name}
                  </div>
                  <div className="file-meta">
                    {formatFileSize(fileItem.size)} • {fileItem.type.split('/')[1].toUpperCase()}
                  </div>
                </div>
              </div>
              <button
                className="remove-file-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  removeFile(fileItem.id)
                }}
                disabled={disabled}
                title="Remove file"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default FileUpload