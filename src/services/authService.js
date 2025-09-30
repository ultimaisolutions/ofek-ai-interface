/**
 * Authentication Service
 * Handles user authentication, login, logout, and session management using Supabase Auth
 */

import supabase from '../lib/supabaseClient'

/**
 * Validates login credentials with Supabase Auth
 * @param {string} email - User email
 * @param {string} password - User password
 * @param {boolean} rememberMe - Whether to persist login (not used, Supabase handles persistence)
 * @returns {Promise<{success: boolean, user?: object, error?: string}>}
 */
export const login = async (email, password, rememberMe = false) => {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    })

    if (error) {
      return {
        success: false,
        error: error.message || 'Invalid email or password'
      }
    }

    if (data.user) {
      // Fetch profile data to get username
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('username, avatar_url')
        .eq('id', data.user.id)
        .single()

      const user = {
        id: data.user.id,
        email: data.user.email,
        username: profile?.username || data.user.email.split('@')[0],
        avatar_url: profile?.avatar_url,
        token: data.session?.access_token,
        loginTime: new Date().toISOString()
      }

      // Store user data in localStorage (Supabase handles session automatically)
      localStorage.setItem('auth-user', JSON.stringify(user))

      return {
        success: true,
        user
      }
    }

    return {
      success: false,
      error: 'Login failed. Please try again.'
    }
  } catch (error) {
    console.error('Login error:', error)
    return {
      success: false,
      error: error.message || 'An unexpected error occurred'
    }
  }
}

/**
 * Registers a new user with Supabase Auth
 * @param {string} email - User email
 * @param {string} username - Username
 * @param {string} password - User password
 * @returns {Promise<{success: boolean, user?: object, error?: string}>}
 */
export const register = async (email, username, password) => {
  try {
    // Sign up with Supabase Auth and include username in metadata
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username: username
        }
      }
    })

    if (error) {
      return {
        success: false,
        error: error.message || 'Registration failed'
      }
    }

    if (data.user) {
      // The profile will be auto-created by the database trigger
      const user = {
        id: data.user.id,
        email: data.user.email,
        username: username,
        token: data.session?.access_token,
        loginTime: new Date().toISOString()
      }

      // Store user data in localStorage
      localStorage.setItem('auth-user', JSON.stringify(user))

      return {
        success: true,
        user
      }
    }

    return {
      success: false,
      error: 'Registration failed. Please try again.'
    }
  } catch (error) {
    console.error('Registration error:', error)
    return {
      success: false,
      error: error.message || 'An unexpected error occurred'
    }
  }
}

/**
 * Logs out the current user and clears all auth data
 */
export const logout = async () => {
  try {
    await supabase.auth.signOut()
  } catch (error) {
    console.error('Logout error:', error)
  }

  // Clear local storage
  localStorage.removeItem('auth-token')
  localStorage.removeItem('auth-user')
  sessionStorage.removeItem('auth-token')
  sessionStorage.removeItem('auth-user')
}

/**
 * Checks if user is currently authenticated
 * @returns {Promise<boolean>}
 */
export const isAuthenticated = async () => {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    return !!session
  } catch (error) {
    console.error('Auth check error:', error)
    return false
  }
}

/**
 * Gets the current authenticated user from Supabase session
 * @returns {Promise<object|null>} User object or null if not authenticated
 */
export const getCurrentUser = async () => {
  try {
    const { data: { session } } = await supabase.auth.getSession()

    if (!session?.user) {
      return null
    }

    // Fetch profile data
    const { data: profile } = await supabase
      .from('profiles')
      .select('username, avatar_url')
      .eq('id', session.user.id)
      .single()

    const user = {
      id: session.user.id,
      email: session.user.email,
      username: profile?.username || session.user.email.split('@')[0],
      avatar_url: profile?.avatar_url,
      token: session.access_token,
      loginTime: new Date(session.user.created_at).toISOString()
    }

    // Update localStorage
    localStorage.setItem('auth-user', JSON.stringify(user))

    return user
  } catch (error) {
    console.error('Error getting current user:', error)
    return null
  }
}

/**
 * Gets the current auth token from Supabase session
 * @returns {Promise<string|null>}
 */
export const getAuthToken = async () => {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token || null
  } catch (error) {
    console.error('Error getting auth token:', error)
    return null
  }
}

export default {
  login,
  register,
  logout,
  isAuthenticated,
  getCurrentUser,
  getAuthToken
}