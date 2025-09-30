/**
 * Supabase Client Configuration
 * Initializes and exports the Supabase client instance for use throughout the app
 */

import { createClient } from '@supabase/supabase-js'

// Get Supabase configuration from environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_PROJECT_REF
  ? `https://${import.meta.env.VITE_SUPABASE_PROJECT_REF}.supabase.co`
  : 'https://gijwrusyutuyscbgpwtv.supabase.co'

const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdpandydXN5dXR1eXNjYmdwd3R2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg5OTczMTMsImV4cCI6MjA3NDU3MzMxM30.Gb0MhImW4RCXSuWwS3wtDBe2k42j1rXKZW1M8kZorMQ'

// Create Supabase client with auth configuration
const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Store session in localStorage for persistence
    storage: window.localStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  }
})

export default supabase
