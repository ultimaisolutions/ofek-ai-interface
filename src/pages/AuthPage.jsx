import { useState } from 'react'
import AnimatedBackground from '../components/AnimatedBackground'
import authService from '../services/authService'
import './AuthPage.css'

/**
 * AuthPage - Authentication page with login and registration
 * Features glass-morphism design matching the main app theme
 */
function AuthPage({ onAuthSuccess }) {
  const [isLogin, setIsLogin] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  // Form state
  const [formData, setFormData] = useState({
    email: '',
    username: '',
    password: '',
    confirmPassword: ''
  })

  // Handle input changes
  const handleInputChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
    setError('') // Clear error on input change
  }

  // Toggle between login and register
  const toggleAuthMode = () => {
    setIsLogin(!isLogin)
    setError('')
    setFormData({
      email: '',
      username: '',
      password: '',
      confirmPassword: ''
    })
  }

  // Form validation
  const validateForm = () => {
    if (!formData.email.trim()) {
      setError('Email is required')
      return false
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(formData.email)) {
      setError('Please enter a valid email address')
      return false
    }

    if (!isLogin && !formData.username.trim()) {
      setError('Username is required')
      return false
    }

    if (!formData.password) {
      setError('Password is required')
      return false
    }

    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters')
      return false
    }

    if (!isLogin && formData.password !== formData.confirmPassword) {
      setError('Passwords do not match')
      return false
    }

    return true
  }

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!validateForm()) return

    setIsLoading(true)
    setError('')

    try {
      if (isLogin) {
        // Login with authService
        const result = await authService.login(formData.email, formData.password, rememberMe)

        if (result.success) {
          // Call success callback
          if (onAuthSuccess) {
            onAuthSuccess(result.user)
          }
        } else {
          setError(result.error)
        }
      } else {
        // Registration with authService
        const result = await authService.register(formData.email, formData.username, formData.password)

        if (result.success) {
          // Call success callback
          if (onAuthSuccess) {
            onAuthSuccess(result.user)
          }
        } else {
          setError(result.error)
        }
      }
    } catch (err) {
      setError(err.message || 'Authentication failed. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <AnimatedBackground />

      <div className="auth-container">
        <div className="auth-card">
          {/* Logo/Title */}
          <div className="auth-header">
            <h1 className="auth-logo">Ultim AI Solutions</h1>
            <p className="auth-subtitle">
              {isLogin ? 'Welcome back' : 'Create your account'}
            </p>
          </div>

          {/* Tab Switcher */}
          <div className="auth-tabs">
            <button
              className={`auth-tab ${isLogin ? 'active' : ''}`}
              onClick={() => setIsLogin(true)}
              type="button"
            >
              Login
            </button>
            <button
              className={`auth-tab ${!isLogin ? 'active' : ''}`}
              onClick={() => setIsLogin(false)}
              type="button"
            >
              Register
            </button>
            <div className={`tab-indicator ${isLogin ? 'login' : 'register'}`} />
          </div>

          {/* Error Message */}
          {error && (
            <div className="auth-error">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M12 8V12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M12 16H12.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {error}
            </div>
          )}

          {/* Form */}
          <form className="auth-form" onSubmit={handleSubmit}>
            {/* Email Input */}
            <div className="form-group">
              <label htmlFor="email" className="form-label">
                Email
              </label>
              <input
                id="email"
                type="email"
                name="email"
                className="form-input"
                placeholder="you@example.com"
                value={formData.email}
                onChange={handleInputChange}
                disabled={isLoading}
                autoComplete="email"
              />
            </div>

            {/* Username Input (Register only) */}
            {!isLogin && (
              <div className="form-group">
                <label htmlFor="username" className="form-label">
                  Username
                </label>
                <input
                  id="username"
                  type="text"
                  name="username"
                  className="form-input"
                  placeholder="johndoe"
                  value={formData.username}
                  onChange={handleInputChange}
                  disabled={isLoading}
                  autoComplete="username"
                />
              </div>
            )}

            {/* Password Input */}
            <div className="form-group">
              <label htmlFor="password" className="form-label">
                Password
              </label>
              <div className="password-input-wrapper">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  className="form-input"
                  placeholder="••••••••"
                  value={formData.password}
                  onChange={handleInputChange}
                  disabled={isLoading}
                  autoComplete={isLogin ? 'current-password' : 'new-password'}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={isLoading}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Confirm Password Input (Register only) */}
            {!isLogin && (
              <div className="form-group">
                <label htmlFor="confirmPassword" className="form-label">
                  Confirm Password
                </label>
                <input
                  id="confirmPassword"
                  type={showPassword ? 'text' : 'password'}
                  name="confirmPassword"
                  className="form-input"
                  placeholder="••••••••"
                  value={formData.confirmPassword}
                  onChange={handleInputChange}
                  disabled={isLoading}
                  autoComplete="new-password"
                />
              </div>
            )}

            {/* Remember Me & Forgot Password (Login only) */}
            {isLogin && (
              <div className="form-options">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    disabled={isLoading}
                  />
                  <span className="checkbox-text">Remember me</span>
                </label>
                <button
                  type="button"
                  className="forgot-password-btn"
                  onClick={() => alert('Password reset functionality coming soon!')}
                  disabled={isLoading}
                >
                  Forgot password?
                </button>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              className="submit-btn"
              disabled={isLoading}
            >
              {isLoading ? (
                <span className="button-loading">
                  <span className="spinner"></span>
                  {isLogin ? 'Signing in...' : 'Creating account...'}
                </span>
              ) : (
                <span>{isLogin ? 'Sign in' : 'Create account'}</span>
              )}
            </button>
          </form>

          {/* Footer */}
          <div className="auth-footer">
            <p className="auth-footer-text">
              {isLogin ? "Don't have an account? " : 'Already have an account? '}
              <button
                type="button"
                className="auth-footer-link"
                onClick={toggleAuthMode}
                disabled={isLoading}
              >
                {isLogin ? 'Sign up' : 'Sign in'}
              </button>
            </p>
          </div>

          {/* Terms & Privacy */}
          <div className="auth-terms">
            <p>
              By continuing, you agree to our{' '}
              <a href="#" onClick={(e) => e.preventDefault()}>Terms of Service</a>
              {' '}and{' '}
              <a href="#" onClick={(e) => e.preventDefault()}>Privacy Policy</a>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AuthPage