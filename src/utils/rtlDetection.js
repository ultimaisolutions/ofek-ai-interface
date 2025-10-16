/**
 * RTL (Right-to-Left) Language Detection Utility
 *
 * Detects and handles RTL languages like Hebrew, Arabic, Persian, etc.
 * Supports bidirectional text with mixed LTR/RTL content.
 */

/**
 * RTL language Unicode ranges
 * - Hebrew: U+0590 - U+05FF
 * - Arabic: U+0600 - U+06FF
 * - Arabic Supplement: U+0750 - U+077F
 * - Arabic Extended-A: U+08A0 - U+08FF
 * - Persian/Urdu: Uses Arabic range
 * - Syriac: U+0700 - U+074F
 */
const RTL_RANGES = [
  [0x0590, 0x05FF], // Hebrew
  [0x0600, 0x06FF], // Arabic
  [0x0700, 0x074F], // Syriac
  [0x0750, 0x077F], // Arabic Supplement
  [0x08A0, 0x08FF], // Arabic Extended-A
  [0xFB1D, 0xFB4F], // Hebrew presentation forms
  [0xFB50, 0xFDFF], // Arabic presentation forms A
  [0xFE70, 0xFEFF], // Arabic presentation forms B
]

/**
 * Check if a character is an RTL character
 * @param {string} char - Single character to check
 * @returns {boolean} True if character is RTL
 */
export function isRTLChar(char) {
  if (!char || char.length === 0) return false

  const code = char.charCodeAt(0)

  return RTL_RANGES.some(([start, end]) => code >= start && code <= end)
}

/**
 * Check if a character is a neutral character (numbers, punctuation, whitespace)
 * @param {string} char - Single character to check
 * @returns {boolean} True if character is neutral
 */
export function isNeutralChar(char) {
  if (!char || char.length === 0) return false

  const code = char.charCodeAt(0)

  // Whitespace, numbers, common punctuation
  return (
    code === 0x0020 || // Space
    (code >= 0x0030 && code <= 0x0039) || // 0-9
    (code >= 0x0021 && code <= 0x002F) || // ! to /
    (code >= 0x003A && code <= 0x0040) || // : to @
    (code >= 0x005B && code <= 0x0060) || // [ to `
    (code >= 0x007B && code <= 0x007E) || // { to ~
    code === 0x000A || // Newline
    code === 0x000D || // Carriage return
    code === 0x0009    // Tab
  )
}

/**
 * Detect the predominant text direction of a string
 * @param {string} text - Text to analyze
 * @param {number} threshold - Percentage of RTL chars needed (0-1), default 0.3 (30%)
 * @returns {'rtl'|'ltr'} Detected direction
 */
export function detectTextDirection(text, threshold = 0.3) {
  if (!text || text.trim().length === 0) {
    return 'ltr' // Default to LTR for empty text
  }

  let rtlCount = 0
  let ltrCount = 0
  let neutralCount = 0

  // Count RTL, LTR, and neutral characters
  for (const char of text) {
    if (isRTLChar(char)) {
      rtlCount++
    } else if (isNeutralChar(char)) {
      neutralCount++
    } else {
      ltrCount++
    }
  }

  const totalSignificant = rtlCount + ltrCount

  // If no significant characters, default to LTR
  if (totalSignificant === 0) {
    return 'ltr'
  }

  const rtlRatio = rtlCount / totalSignificant

  // If RTL ratio exceeds threshold, it's RTL
  return rtlRatio >= threshold ? 'rtl' : 'ltr'
}

/**
 * Get the first strong directional character in text
 * This helps determine initial direction for mixed content
 * @param {string} text - Text to analyze
 * @returns {'rtl'|'ltr'|null} Direction of first strong character, or null if none found
 */
export function getFirstStrongDirection(text) {
  if (!text || text.trim().length === 0) {
    return null
  }

  for (const char of text) {
    if (isRTLChar(char)) {
      return 'rtl'
    }
    if (!isNeutralChar(char)) {
      return 'ltr'
    }
  }

  return null
}

/**
 * Check if text contains any RTL characters
 * @param {string} text - Text to check
 * @returns {boolean} True if text contains RTL characters
 */
export function hasRTLChars(text) {
  if (!text) return false

  for (const char of text) {
    if (isRTLChar(char)) {
      return true
    }
  }

  return false
}

/**
 * Check if text is mixed bidirectional (contains both RTL and LTR)
 * @param {string} text - Text to check
 * @returns {boolean} True if text contains both RTL and LTR characters
 */
export function isMixedBidiText(text) {
  if (!text) return false

  let hasRTL = false
  let hasLTR = false

  for (const char of text) {
    if (isRTLChar(char)) {
      hasRTL = true
    } else if (!isNeutralChar(char)) {
      hasLTR = true
    }

    // Early exit if we found both
    if (hasRTL && hasLTR) {
      return true
    }
  }

  return false
}

/**
 * Get recommended CSS direction and alignment for text
 * @param {string} text - Text to analyze
 * @returns {{dir: 'rtl'|'ltr', textAlign: 'right'|'left'}} CSS properties
 */
export function getTextDirectionStyle(text) {
  const dir = detectTextDirection(text)

  return {
    dir,
    textAlign: dir === 'rtl' ? 'right' : 'left'
  }
}

export default {
  isRTLChar,
  isNeutralChar,
  detectTextDirection,
  getFirstStrongDirection,
  hasRTLChars,
  isMixedBidiText,
  getTextDirectionStyle
}
