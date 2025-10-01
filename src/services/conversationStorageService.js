/**
 * Conversation Storage Service
 * Handles persistence of conversations and messages to Supabase database
 * Provides simple CRUD operations for chat history with user isolation
 */

import supabase from '../lib/supabaseClient'

/**
 * Saves or updates a conversation in Supabase
 * @param {string} userId - The authenticated user's ID
 * @param {number} chatId - Local chat ID (for backwards compatibility)
 * @param {string} title - Conversation title
 * @param {string} sessionId - n8n session ID for conversation continuity
 * @param {Array} messages - Array of message objects
 * @param {string} supabaseId - Existing Supabase UUID (for updates)
 * @returns {Promise<{success: boolean, id?: string, error?: string}>}
 */
export const saveConversation = async (userId, chatId, title, sessionId, messages, supabaseId = null) => {
  try {
    // Prepare the data
    const conversationData = {
      title,
      session_id: sessionId,
      messages_json: messages,
      user_id: userId,
      updated_at: new Date().toISOString()
    }

    let result

    if (supabaseId) {
      // Update existing conversation
      const { data, error } = await supabase
        .from('chats')
        .update(conversationData)
        .eq('id', supabaseId)
        .eq('user_id', userId) // Ensure user owns this chat
        .select()
        .single()

      if (error) throw error
      result = data
    } else {
      // Create new conversation
      const { data, error } = await supabase
        .from('chats')
        .insert([conversationData])
        .select()
        .single()

      // Handle duplicate session_id conflict (error code 23505)
      if (error && error.code === '23505' && error.message.includes('session_id')) {
        console.warn('Session ID conflict detected, regenerating with timestamp suffix...')
        // Regenerate session ID with additional timestamp to ensure uniqueness
        conversationData.session_id = `${sessionId}_${Date.now()}`

        // Retry insert with new session ID
        const retryResult = await supabase
          .from('chats')
          .insert([conversationData])
          .select()
          .single()

        if (retryResult.error) throw retryResult.error
        result = retryResult.data
      } else if (error) {
        throw error
      } else {
        result = data
      }
    }

    return {
      success: true,
      id: result.id,
      data: result
    }
  } catch (error) {
    console.error('Error saving conversation:', error)
    return {
      success: false,
      error: error.message || 'Failed to save conversation'
    }
  }
}

/**
 * Retrieves recent conversations for a user
 * @param {string} userId - The authenticated user's ID
 * @param {number} limit - Number of conversations to fetch (default 20)
 * @param {number} offset - Offset for pagination (default 0)
 * @returns {Promise<{success: boolean, conversations?: Array, error?: string}>}
 */
export const getRecentConversations = async (userId, limit = 20, offset = 0) => {
  try {
    console.log('[ConversationService] Fetching conversations for user:', userId)

    // Add timeout to prevent hanging
    const controller = new AbortController()
    const timeoutId = setTimeout(() => {
      console.warn('[ConversationService] Query timeout after 5 seconds, aborting...')
      controller.abort()
    }, 5000)

    const { data, error } = await supabase
      .from('chats')
      .select('id, title, session_id, messages_json, created_at, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1)
      .abortSignal(controller.signal)

    clearTimeout(timeoutId)
    console.log('[ConversationService] Query completed, data:', data?.length || 0, 'conversations')

    if (error) {
      console.error('[ConversationService] Query error:', error)
      throw error
    }

    return {
      success: true,
      conversations: data || []
    }
  } catch (error) {
    console.error('[ConversationService] Error fetching conversations:', error)
    return {
      success: false,
      error: error.message || 'Failed to fetch conversations',
      conversations: []  // Return empty array on error
    }
  }
}

/**
 * Deletes a conversation from Supabase
 * @param {string} supabaseId - The Supabase UUID of the chat
 * @param {string} userId - The authenticated user's ID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const deleteConversation = async (supabaseId, userId) => {
  try {
    const { error } = await supabase
      .from('chats')
      .delete()
      .eq('id', supabaseId)
      .eq('user_id', userId) // Ensure user owns this chat

    if (error) throw error

    return {
      success: true
    }
  } catch (error) {
    console.error('Error deleting conversation:', error)
    return {
      success: false,
      error: error.message || 'Failed to delete conversation'
    }
  }
}

/**
 * Migrates existing localStorage conversations to Supabase
 * @param {string} userId - The authenticated user's ID
 * @returns {Promise<{success: boolean, migratedCount?: number, error?: string}>}
 */
export const migrateLocalStorageToSupabase = async (userId) => {
  try {
    console.log('[ConversationService] Starting migration for userId:', userId)
    // Get data from localStorage
    const chatHistoryStr = localStorage.getItem('ai-chat-history')
    const allMessagesStr = localStorage.getItem('ai-all-chat-messages')
    const sessionIdsStr = localStorage.getItem('ai-chat-session-ids')

    console.log('[ConversationService] LocalStorage data found:', {
      hasChatHistory: !!chatHistoryStr,
      hasAllMessages: !!allMessagesStr,
      hasSessionIds: !!sessionIdsStr
    })

    if (!chatHistoryStr || !allMessagesStr) {
      console.log('[ConversationService] No data to migrate')
      return {
        success: true,
        migratedCount: 0
      }
    }

    const chatHistory = JSON.parse(chatHistoryStr)
    const allMessages = JSON.parse(allMessagesStr)
    const sessionIds = sessionIdsStr ? JSON.parse(sessionIdsStr) : {}

    console.log('[ConversationService] Parsed data:', {
      chatCount: chatHistory.length,
      messageKeys: Object.keys(allMessages).length,
      sessionIdKeys: Object.keys(sessionIds).length
    })

    let migratedCount = 0

    // Migrate each conversation
    for (const chat of chatHistory) {
      const chatId = chat.id
      const messages = allMessages[chatId] || []
      const sessionId = sessionIds[chatId] || `session_${chatId}_${Date.now()}_migrated`

      console.log(`[ConversationService] Migrating chat ${chatId}:`, {
        title: chat.title,
        messageCount: messages.length,
        sessionId
      })

      const result = await saveConversation(
        userId,
        chatId,
        chat.title,
        sessionId,
        messages
      )

      if (result.success) {
        migratedCount++
        console.log(`[ConversationService] Successfully migrated chat ${chatId}`)
      } else {
        console.error(`[ConversationService] Failed to migrate chat ${chatId}:`, result.error)
      }
    }

    console.log(`[ConversationService] Migration complete: ${migratedCount}/${chatHistory.length} conversations`)

    return {
      success: true,
      migratedCount
    }
  } catch (error) {
    console.error('Error migrating localStorage to Supabase:', error)
    return {
      success: false,
      error: error.message || 'Migration failed'
    }
  }
}

/**
 * Checks if user has any conversations in Supabase
 * @param {string} userId - The authenticated user's ID
 * @returns {Promise<{success: boolean, hasConversations?: boolean, error?: string}>}
 */
export const hasConversationsInSupabase = async (userId) => {
  try {
    const { data, error } = await supabase
      .from('chats')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .limit(1)

    if (error) throw error

    return {
      success: true,
      hasConversations: data && data.length > 0
    }
  } catch (error) {
    console.error('Error checking conversations:', error)
    return {
      success: false,
      error: error.message || 'Failed to check conversations'
    }
  }
}

export default {
  saveConversation,
  getRecentConversations,
  deleteConversation,
  migrateLocalStorageToSupabase,
  hasConversationsInSupabase
}
