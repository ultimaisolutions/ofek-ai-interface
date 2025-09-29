import { useState, useEffect } from 'react'
import './App.css'
import { sendMessageToWebhookWithRetry, generateUUID } from './services/webhookService'
import responseListenerService from './services/responseListenerService'
import httpLogger from './services/httpLoggerService'
import { sanitizeUserInput } from './services/inputSanitizationService'
import FileUploadButton from './components/FileUploadButton'
import fileStorageService from './services/fileStorageService'

function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(window.innerWidth < 768)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  const [messages, setMessages] = useState([
    { id: generateUUID(), type: 'ai', content: 'Hello! How can I assist you today?', timestamp: new Date() }
  ])
  const [chatHistory, setChatHistory] = useState([
    { id: 1, title: 'New Conversation', timestamp: new Date() }
  ])
  const [currentChatId, setCurrentChatId] = useState(1)
  const [inputValue, setInputValue] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [isSending, setIsSending] = useState(false)

  // File upload states
  const [selectedFiles, setSelectedFiles] = useState([])
  const [fileUploadErrors, setFileUploadErrors] = useState([])
  const [uploadingFiles, setUploadingFiles] = useState(new Map())
  const [sessionId] = useState(() => {
    const saved = localStorage.getItem('ai-chat-session-id')
    return saved || fileStorageService.generateSessionId()
  })

  // Response listener states
  const [connectionStatus, setConnectionStatus] = useState('disconnected')
  const [pendingResponseCount, setPendingResponseCount] = useState(0)
  const [lastConnectionError, setLastConnectionError] = useState(null)
  const [messageStates, setMessageStates] = useState(new Map())

  // Load data from localStorage on component mount
  useEffect(() => {
    const savedChatHistory = localStorage.getItem('ai-chat-history')
    const savedMessages = localStorage.getItem('ai-chat-messages')
    const savedCurrentChatId = localStorage.getItem('ai-current-chat-id')

    if (savedChatHistory) {
      try {
        const parsedHistory = JSON.parse(savedChatHistory)
        // Convert timestamp strings back to Date objects
        const historyWithDates = parsedHistory.map(chat => ({
          ...chat,
          timestamp: new Date(chat.timestamp)
        }))
        setChatHistory(historyWithDates)
      } catch (error) {
        console.error('Error parsing chat history:', error)
      }
    }

    if (savedMessages) {
      try {
        const parsedMessages = JSON.parse(savedMessages)
        // Convert timestamp strings back to Date objects
        const messagesWithDates = parsedMessages.map(message => ({
          ...message,
          timestamp: new Date(message.timestamp)
        }))
        setMessages(messagesWithDates)
      } catch (error) {
        console.error('Error parsing messages:', error)
      }
    }

    if (savedCurrentChatId) {
      setCurrentChatId(parseInt(savedCurrentChatId))
    }
  }, [])

  // Save chat history to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('ai-chat-history', JSON.stringify(chatHistory))
  }, [chatHistory])

  // Save messages to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('ai-chat-messages', JSON.stringify(messages))
  }, [messages])

  // Save current chat ID to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('ai-current-chat-id', currentChatId.toString())
  }, [currentChatId])

  // Save session ID to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('ai-chat-session-id', sessionId)
  }, [sessionId])

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768
      setIsMobile(mobile)
      if (!mobile && sidebarCollapsed) {
        setSidebarCollapsed(false)
      }
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [sidebarCollapsed])

  // Initialize response listener service
  useEffect(() => {
    httpLogger.createLogEntry('INFO', 'APP_LIFECYCLE',
      'App component mounting - initializing response listener service',
      {}
    );

    // Set up event listeners for response service
    const handleStatusChange = (data) => {
      httpLogger.logStateChange('App', 'connectionStatus', connectionStatus, data.status, {
        timestamp: data.timestamp
      });

      setConnectionStatus(data.status)
      if (data.status === 'error') {
        setLastConnectionError({
          message: 'Connection error occurred',
          timestamp: data.timestamp
        })
      } else if (data.status === 'connected') {
        setLastConnectionError(null)
      }
    }

    const handleMessageReceived = (data) => {
      const messageId = data.correlationId || data.messageId;

      httpLogger.createLogEntry('INFO', 'APP_MESSAGE',
        'AI response received in App component',
        {
          messageId,
          source: data.source,
          contentLength: data.content?.length || 0,
          hasError: !!data.error
        }
      );

      // Update message state
      if (messageId) {
        httpLogger.logStateChange('App', 'messageStates',
          messageStates.get(messageId), 'response_received', {
          messageId
        });

        setMessageStates(prev => {
          const newStates = new Map(prev)
          newStates.set(messageId, 'response_received')
          return newStates
        })
      }

      // Add AI message to chat
      const aiMessage = {
        id: generateUUID(),
        type: 'ai',
        content: data.content || data.error || 'Received response from AI service',
        timestamp: new Date(),
        responseData: data,
        correlationId: messageId
      }

      setMessages(prev => [...prev, aiMessage])
      setIsTyping(false)
    }

    const handleMessageTimeout = (data) => {
      console.warn('AI response timeout:', data)

      setMessageStates(prev => {
        const newStates = new Map(prev)
        newStates.set(data.messageId, 'timeout')
        return newStates
      })

      const timeoutMessage = {
        id: generateUUID(),
        type: 'ai',
        content: 'Response timed out. The AI service may be experiencing delays. Please try again.',
        timestamp: new Date(),
        isError: true,
        correlationId: data.messageId
      }

      setMessages(prev => [...prev, timeoutMessage])
      setIsTyping(false)
    }

    const handleConnectionFailed = (data) => {
      setLastConnectionError({
        message: `Connection failed after ${data.attempts} attempts`,
        timestamp: data.timestamp
      })

      const errorMessage = {
        id: generateUUID(),
        type: 'ai',
        content: 'Unable to establish connection with AI service. Please check your internet connection and try again.',
        timestamp: new Date(),
        isError: true
      }

      setMessages(prev => [...prev, errorMessage])
      setIsTyping(false)
    }

    // Add event listeners
    responseListenerService.addEventListener('statusChange', handleStatusChange)
    responseListenerService.addEventListener('messageReceived', handleMessageReceived)
    responseListenerService.addEventListener('messageTimeout', handleMessageTimeout)
    responseListenerService.addEventListener('connectionFailed', handleConnectionFailed)

    // FIXED: Do NOT start listening on app mount - only start when actually sending messages
    httpLogger.createLogEntry('INFO', 'APP_LIFECYCLE',
      'Response listener service initialized but NOT started - will only start when sending messages',
      {
        fix: 'Removed automatic startListening() call to prevent unnecessary polling'
      }
    );

    // DO NOT START LISTENING HERE - this was the root cause of unnecessary polling
    // responseListenerService.startListening() // REMOVED - causing unnecessary requests


    // Cleanup
    return () => {
      responseListenerService.removeEventListener('statusChange', handleStatusChange)
      responseListenerService.removeEventListener('messageReceived', handleMessageReceived)
      responseListenerService.removeEventListener('messageTimeout', handleMessageTimeout)
      responseListenerService.removeEventListener('connectionFailed', handleConnectionFailed)
      responseListenerService.stopListening()
    }
  }, [])

  // Update pending response count
  useEffect(() => {
    const updatePendingCount = () => {
      setPendingResponseCount(responseListenerService.getPendingMessagesCount())
    }

    const interval = setInterval(updatePendingCount, 1000)
    return () => clearInterval(interval)
  }, [])

  const toggleSidebar = () => {
    setSidebarCollapsed(!sidebarCollapsed)
  }

  // File upload handlers
  const handleFilesSelected = (files, errors, removedFileId) => {
    if (removedFileId) {
      setSelectedFiles(prev => prev.filter(f => f.id !== removedFileId))
      return
    }

    if (errors && errors.length > 0) {
      setFileUploadErrors(errors)
      setTimeout(() => setFileUploadErrors([]), 5000)
      return
    }

    if (files && files.length > 0) {
      setSelectedFiles(prev => [...prev, ...files])
      setFileUploadErrors([])
    }
  }


  const uploadFiles = async (messageId) => {
    if (selectedFiles.length === 0) return []

    const uploadPromises = selectedFiles.map(async (fileItem) => {
      try {
        setUploadingFiles(prev => new Map(prev).set(fileItem.id, { status: 'uploading', progress: 0 }))

        const result = await fileStorageService.uploadFile(
          fileItem.file,
          messageId,
          sessionId,
          (progress, message) => {
            setUploadingFiles(prev => new Map(prev).set(fileItem.id, {
              status: 'uploading',
              progress,
              message
            }))
          }
        )

        setUploadingFiles(prev => new Map(prev).set(fileItem.id, {
          status: 'completed',
          progress: 100,
          result
        }))

        return result.metadata

      } catch (error) {
        console.error('File upload failed:', error)
        setUploadingFiles(prev => new Map(prev).set(fileItem.id, {
          status: 'failed',
          progress: 0,
          error: error.message
        }))
        return null
      }
    })

    const results = await Promise.all(uploadPromises)
    return results.filter(result => result !== null)
  }

  const sendMessage = async () => {
    if (!inputValue.trim() && selectedFiles.length === 0) return

    const userMessage = {
      id: generateUUID(),
      type: 'user',
      content: sanitizeUserInput(inputValue) || (selectedFiles.length > 0 ? '[File attachments]' : ''),
      timestamp: new Date(),
      fileAttachments: []
    }

    httpLogger.logMessageFlow(userMessage.id, 'USER_MESSAGE_CREATED', {
      contentLength: userMessage.content.length,
      contentPreview: userMessage.content.substring(0, 50) + (userMessage.content.length > 50 ? '...' : '')
    });

    setMessages(prev => [...prev, userMessage])
    setInputValue('')
    setIsSending(true)

    // Upload files if any are selected
    let uploadedFiles = []
    if (selectedFiles.length > 0) {
      try {
        uploadedFiles = await uploadFiles(userMessage.id)

        // Update the message with file attachments
        const updatedMessage = {
          ...userMessage,
          fileAttachments: uploadedFiles
        }

        setMessages(prev => prev.map(msg =>
          msg.id === userMessage.id ? updatedMessage : msg
        ))

        // Clear selected files after successful upload
        setSelectedFiles([])
        setUploadingFiles(new Map())

      } catch (error) {
        console.error('File upload failed:', error)
        setFileUploadErrors([`File upload failed: ${error.message}`])
      }
    }

    // Set initial message state
    httpLogger.logStateChange('App', 'messageStates', null, 'sending', {
      messageId: userMessage.id
    });

    setMessageStates(prev => {
      const newStates = new Map(prev)
      newStates.set(userMessage.id, 'sending')
      return newStates
    })

    // Send message to webhook with response correlation
    try {
      const webhookOptions = {
        expectResponse: true,
        responseFormat: 'json',
        userId: 'anonymous',
        sessionId: null // Will be auto-generated
      }

      const webhookResult = await sendMessageToWebhookWithRetry(userMessage, webhookOptions);

      if (webhookResult.success) {
        // Update message state to sent
        setMessageStates(prev => {
          const newStates = new Map(prev)
          newStates.set(userMessage.id, 'sent')
          return newStates
        })

        // Check if this is just an acknowledgment or actual response
        if (webhookResult.isAcknowledgment) {
          console.log('Message acknowledged, waiting for AI response...')
          setIsTyping(true)

          // Start listening for the specific response
          responseListenerService.startListening(webhookResult.messageId)

          // Update message state to waiting for response
          setMessageStates(prev => {
            const newStates = new Map(prev)
            newStates.set(userMessage.id, 'waiting_response')
            return newStates
          })
        } else {
          // Handle immediate response
          const aiMessage = {
            id: generateUUID(),
            type: 'ai',
            content: webhookResult.data?.content || webhookResult.rawData || 'Response received',
            timestamp: new Date(),
            correlationId: webhookResult.messageId
          }
          setMessages(prev => [...prev, aiMessage])

          setMessageStates(prev => {
            const newStates = new Map(prev)
            newStates.set(userMessage.id, 'response_received')
            return newStates
          })
        }
      } else {
        // Update message state to failed
        setMessageStates(prev => {
          const newStates = new Map(prev)
          newStates.set(userMessage.id, 'failed')
          return newStates
        })

        // Create an error response message
        const aiMessage = {
          id: generateUUID(),
          type: 'ai',
          content: `Failed to send message: ${webhookResult.error}`,
          timestamp: new Date(),
          isError: true
        }
        setMessages(prev => [...prev, aiMessage])
      }
    } catch (error) {
      // Update message state to failed
      setMessageStates(prev => {
        const newStates = new Map(prev)
        newStates.set(userMessage.id, 'failed')
        return newStates
      })

      // Handle unexpected errors
      const aiMessage = {
        id: generateUUID(),
        type: 'ai',
        content: `Unexpected error occurred: ${error.message}`,
        timestamp: new Date(),
        isError: true
      }
      setMessages(prev => [...prev, aiMessage])
    } finally {
      setIsSending(false)
    }
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const createNewChat = () => {
    const newChatId = Date.now()
    const newChat = {
      id: newChatId,
      title: 'New Conversation',
      timestamp: new Date()
    }
    setChatHistory(prev => [newChat, ...prev])
    setCurrentChatId(newChatId)
    setMessages([
      { id: generateUUID(), type: 'ai', content: 'Hello! How can I assist you today?', timestamp: new Date() }
    ])
  }

  const selectChat = (chatId) => {
    setCurrentChatId(chatId)
    // In a real app, you would load messages for this specific chat
    // For now, we'll keep the current implementation
  }

  // Retry connection manually
  const retryConnection = () => {
    setLastConnectionError(null)
    responseListenerService.retryConnection()
  }

  // Get connection status display info
  const getConnectionStatusInfo = () => {
    switch (connectionStatus) {
      case 'connected':
        return { text: 'Connected', color: 'green', icon: '●' }
      case 'connecting':
        return { text: 'Connecting...', color: 'orange', icon: '○' }
      case 'error':
        return { text: 'Connection Error', color: 'red', icon: '●' }
      case 'disconnected':
      default:
        return { text: 'Disconnected', color: 'gray', icon: '○' }
    }
  }

  // Get message status info
  const getMessageStatus = (messageId, messageType) => {
    if (messageType !== 'user') return null

    const state = messageStates.get(messageId)
    switch (state) {
      case 'sending':
        return { text: 'Sending...', color: 'orange', icon: '⏳' }
      case 'sent':
        return { text: 'Sent', color: 'blue', icon: '✓' }
      case 'waiting_response':
        return { text: 'AI thinking...', color: 'purple', icon: '🤔' }
      case 'response_received':
        return { text: 'Response received', color: 'green', icon: '✓✓' }
      case 'failed':
        return { text: 'Failed', color: 'red', icon: '✗' }
      case 'timeout':
        return { text: 'Timeout', color: 'orange', icon: '⏰' }
      default:
        return null
    }
  }

  return (
    <div className="app">
      {/* Mobile overlay */}
      {!sidebarCollapsed && isMobile && (
        <div className="mobile-overlay" onClick={toggleSidebar}></div>
      )}

      {/* Mobile floating button */}
      {sidebarCollapsed && (
        <button className="mobile-menu-btn" onClick={toggleSidebar}>
          <span className="hamburger"></span>
        </button>
      )}

      <div className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <button className="collapse-btn" onClick={toggleSidebar}>
            <span className="hamburger"></span>
          </button>
          {!sidebarCollapsed && (
            <>
              <h2>Conversations</h2>
              <button className="new-chat-btn" onClick={createNewChat}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M12 5V19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </>
          )}
        </div>
        {!sidebarCollapsed && (
          <div className="chat-history">
            {chatHistory.map(chat => (
              <div
                key={chat.id}
                className={`chat-item ${chat.id === currentChatId ? 'active' : ''}`}
                onClick={() => selectChat(chat.id)}
              >
                <span className="chat-title">{chat.title}</span>
                <span className="chat-time">
                  {chat.timestamp.toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="main-content">
        {/* Connection Status Bar */}
        <div className="connection-status-bar">
          <div className="connection-info">
            <span
              className="connection-indicator"
              style={{ color: getConnectionStatusInfo().color }}
            >
              {getConnectionStatusInfo().icon}
            </span>
            <span className="connection-text">
              {getConnectionStatusInfo().text}
            </span>
            {pendingResponseCount > 0 && (
              <span className="pending-count">
                • Waiting for {pendingResponseCount} response{pendingResponseCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {lastConnectionError && (
            <div className="connection-error">
              <span className="error-message">{lastConnectionError.message}</span>
              <button
                className="retry-btn"
                onClick={retryConnection}
                disabled={connectionStatus === 'connecting'}
              >
                Retry
              </button>
            </div>
          )}

          {!lastConnectionError && connectionStatus === 'disconnected' && (
            <div className="connection-controls">
              <button
                className="test-connection-btn"
                onClick={retryConnection}
                disabled={connectionStatus === 'connecting'}
              >
                Test Connection
              </button>
            </div>
          )}
        </div>

        <div className="chat-window">
          {messages.map(message => {
            const messageStatus = getMessageStatus(message.id, message.type)
            return (
              <div key={message.id} className={`message ${message.type} ${message.isError ? 'error' : ''}`}>
                <div className="message-content">
                  {message.content}

                  {/* File Attachments */}
                  {message.fileAttachments && message.fileAttachments.length > 0 && (
                    <div className="message-attachments">
                      {message.fileAttachments.map((file, index) => (
                        <div key={index} className="file-attachment">
                          <div className="file-attachment-info">
                            <span className="file-icon">
                              {file.file_type.startsWith('image/') ? '🖼️' :
                               file.file_type.startsWith('video/') ? '🎥' :
                               file.file_type.startsWith('audio/') ? '🎵' :
                               file.file_type.includes('pdf') ? '📄' :
                               file.file_type.includes('word') || file.file_type.includes('document') ? '📝' :
                               file.file_type.includes('sheet') || file.file_type.includes('excel') || file.file_type.includes('csv') ? '📊' :
                               '📎'}
                            </span>
                            <div className="file-details">
                              <div className="file-name" title={file.file_name}>
                                {file.file_name}
                              </div>
                              <div className="file-meta">
                                {(file.file_size / 1024).toFixed(1)} KB • {file.file_type.split('/')[1]?.toUpperCase()}
                              </div>
                            </div>
                          </div>
                          {file.thumbnail_url && (
                            <div className="file-thumbnail">
                              <img src={file.thumbnail_url} alt="Preview" />
                            </div>
                          )}
                          <div className="file-actions">
                            <a
                              href={file.download_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="download-btn"
                              title="Download file"
                            >
                              ⬇️
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {messageStatus && (
                    <div className="message-status" style={{ color: messageStatus.color }}>
                      <span className="status-icon">{messageStatus.icon}</span>
                      <span className="status-text">{messageStatus.text}</span>
                    </div>
                  )}
                </div>
                {message.correlationId && (
                  <div className="message-correlation" title={`Correlation ID: ${message.correlationId}`}>
                    🔗
                  </div>
                )}
              </div>
            )
          })}
          {(isTyping || isSending) && (
            <div className="message ai">
              <div className="message-content typing">
                <div className="typing-indicator">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
                {isSending && <div className="sending-status">Sending to webhook...</div>}
                {isTyping && !isSending && <div className="thinking-status">AI is thinking...</div>}
              </div>
            </div>
          )}
        </div>

        <div className="chat-input-container">
          {/* File Upload Errors */}
          {fileUploadErrors.length > 0 && (
            <div className="file-upload-error">
              {fileUploadErrors.map((error, index) => (
                <div key={index} className="error-message">{error}</div>
              ))}
            </div>
          )}

          {/* Selected Files Preview */}
          {selectedFiles.length > 0 && (
            <div className="selected-files-preview">
              {selectedFiles.map((fileItem) => (
                <div key={fileItem.id} className="file-preview-item">
                  <span className="file-icon">
                    {fileItem.type.startsWith('image/') ? '🖼️' :
                     fileItem.type.startsWith('video/') ? '🎥' :
                     fileItem.type.startsWith('audio/') ? '🎵' :
                     fileItem.type.includes('pdf') ? '📄' :
                     fileItem.type.includes('word') || fileItem.type.includes('document') ? '📝' :
                     fileItem.type.includes('sheet') || fileItem.type.includes('excel') || fileItem.type.includes('csv') ? '📊' :
                     '📎'}
                  </span>
                  <span className="file-name">{fileItem.name}</span>
                  <button
                    className="remove-file-btn"
                    onClick={() => handleFilesSelected([], [], fileItem.id)}
                    title="Remove file"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Upload Progress */}
          {uploadingFiles.size > 0 && (
            <div className="upload-progress-container">
              {Array.from(uploadingFiles.entries()).map(([fileId, uploadInfo]) => (
                <div key={fileId} className={`upload-progress ${uploadInfo.status}`}>
                  <div className="upload-info">
                    <span className="file-name">
                      {selectedFiles.find(f => f.id === fileId)?.name || 'Unknown file'}
                    </span>
                    <span className="upload-status">{uploadInfo.message || uploadInfo.status}</span>
                  </div>
                  {uploadInfo.status === 'uploading' && (
                    <div className="progress-bar">
                      <div
                        className="progress-fill"
                        style={{ width: `${uploadInfo.progress}%` }}
                      />
                    </div>
                  )}
                  {uploadInfo.status === 'failed' && (
                    <div className="error-text">{uploadInfo.error}</div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="chat-input">
            <FileUploadButton
              onFilesSelected={handleFilesSelected}
              disabled={isSending}
              maxFiles={3}
              maxSizeBytes={10 * 1024 * 1024}
            />
            <input
              type="text"
              placeholder="Type your message here..."
              className="message-input"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
            />
            <button
              className="send-btn"
              onClick={sendMessage}
              disabled={(!inputValue.trim() && selectedFiles.length === 0) || isSending}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
