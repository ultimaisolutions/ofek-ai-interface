import { useState, useRef, useCallback } from 'react'
import './FileUploadButton.css'

const FileUploadButton = ({ onFilesSelected, disabled = false, maxFiles = 3, maxSizeBytes = 10 * 1024 * 1024 }) => {
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef(null)

  const supportedTypes = useCallback(() => ({
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'text/plain': '.txt',
    'application/rtf': '.rtf',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'text/csv': '.csv',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'video/mp4': '.mp4',
    'video/avi': '.avi',
    'video/quicktime': '.mov',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg'
  }), [])

  const validateFile = useCallback((file) => {
    const errors = []

    if (!supportedTypes()[file.type]) {
      errors.push(`File type "${file.type}" is not supported`)
    }

    if (file.size > maxSizeBytes) {
      const sizeMB = (maxSizeBytes / (1024 * 1024)).toFixed(1)
      errors.push(`File size exceeds ${sizeMB}MB limit`)
    }

    const fileName = file.name
    const dangerousPatterns = [
      /\.exe$/i, /\.bat$/i, /\.cmd$/i, /\.scr$/i, /\.vbs$/i, /\.js$/i,
      /\.\./,
      /[<>:"|?*]/,
    ]

    for (const pattern of dangerousPatterns) {
      if (pattern.test(fileName)) {
        errors.push(`File name contains invalid characters or extension`)
        break
      }
    }

    return errors
  }, [maxSizeBytes, supportedTypes])

  const processFiles = useCallback((files) => {
    const fileArray = Array.from(files)
    const validFiles = []
    const errors = []

    if (fileArray.length > maxFiles) {
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
  }, [maxFiles, validateFile])

  const handleFileInputChange = useCallback((e) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    const { validFiles, errors } = processFiles(files)

    if (validFiles.length > 0 || errors.length > 0) {
      onFilesSelected(validFiles, errors)
    }

    e.target.value = ''
  }, [processFiles, onFilesSelected])

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

    if (validFiles.length > 0 || errors.length > 0) {
      onFilesSelected(validFiles, errors)
    }
  }, [disabled, processFiles, onFilesSelected])

  const openFileDialog = useCallback(() => {
    if (!disabled && fileInputRef.current) {
      fileInputRef.current.click()
    }
  }, [disabled])

  return (
    <div
      className={`file-upload-button ${isDragOver ? 'drag-over' : ''} ${disabled ? 'disabled' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={Object.keys(supportedTypes()).join(',')}
        onChange={handleFileInputChange}
        style={{ display: 'none' }}
        disabled={disabled}
      />

      <button
        type="button"
        className="file-button"
        onClick={openFileDialog}
        disabled={disabled}
        title="Attach files (drag & drop or click)"
      >
        📎
      </button>
    </div>
  )
}

export default FileUploadButton