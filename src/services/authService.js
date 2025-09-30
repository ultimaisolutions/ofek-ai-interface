/**
 * Authentication Service
 * Handles user authentication, login, logout, and session management
 */

// ============================================================================
// TEMPORARY WORKAROUND: Hard-coded credentials
// TODO: Replace with proper user database and authentication API
// This is a temporary solution for development/testing purposes only
// ============================================================================
const TEMP_HARDCODED_USER = {
  email: 'ofekloya@ultimaisolutions.com',
  password: '123456',
  username: 'Ofek Loya'
}
// ============================================================================

/**
 * Validates login credentials against hard-coded user
 * @param {string} email - User email
 * @param {string} password - User password
 * @param {boolean} rememberMe - Whether to persist login
 * @returns {Promise<{success: boolean, user?: object, error?: string}>}
 */
export const login = async (email, password, rememberMe = false) => {
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 800))

  // Validate against hard-coded credentials
  if (email === TEMP_HARDCODED_USER.email && password === TEMP_HARDCODED_USER.password) {
    const user = {
      email: TEMP_HARDCODED_USER.email,
      username: TEMP_HARDCODED_USER.username,
      token: 'temp-jwt-token-' + Date.now(),
      loginTime: new Date().toISOString()
    }

    // Store auth data
    const storage = rememberMe ? localStorage : sessionStorage
    storage.setItem('auth-token', user.token)
    storage.setItem('auth-user', JSON.stringify(user))

    return {
      success: true,
      user
    }
  }

  return {
    success: false,
    error: 'Invalid email or password'
  }
}

/**
 * Registers a new user
 * @param {string} email - User email
 * @param {string} username - Username
 * @param {string} password - User password
 * @returns {Promise<{success: boolean, user?: object, error?: string}>}
 */
export const register = async (email, username, password) => {
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 800))

  // For now, registration is disabled - only the hard-coded user can login
  return {
    success: false,
    error: 'Registration is currently disabled. Please contact an administrator.'
  }
}

/**
 * Logs out the current user and clears all auth data
 */
export const logout = () => {
  // Clear from both storage types
  localStorage.removeItem('auth-token')
  localStorage.removeItem('auth-user')
  sessionStorage.removeItem('auth-token')
  sessionStorage.removeItem('auth-user')
}

/**
 * Checks if user is currently authenticated
 * @returns {boolean}
 */
export const isAuthenticated = () => {
  const token = localStorage.getItem('auth-token') || sessionStorage.getItem('auth-token')
  return !!token
}

/**
 * Gets the current authenticated user
 * @returns {object|null} User object or null if not authenticated
 */
export const getCurrentUser = () => {
  try {
    const userStr = localStorage.getItem('auth-user') || sessionStorage.getItem('auth-user')
    if (userStr) {
      return JSON.parse(userStr)
    }
  } catch (error) {
    console.error('Error parsing user data:', error)
  }
  return null
}

/**
 * Gets the current auth token
 * @returns {string|null}
 */
export const getAuthToken = () => {
  return localStorage.getItem('auth-token') || sessionStorage.getItem('auth-token')
}

export default {
  login,
  register,
  logout,
  isAuthenticated,
  getCurrentUser,
  getAuthToken
}