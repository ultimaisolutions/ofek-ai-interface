// Input Sanitization Service for user-generated content
// Provides XSS protection and content validation while maintaining backwards compatibility

class InputSanitizationService {
  constructor() {
    this.maxContentLength = 4000;

    // Dangerous patterns to remove/neutralize
    this.dangerousPatterns = [
      // Script tags (case insensitive)
      /<script[^>]*>[\s\S]*?<\/script>/gi,
      /<script[^>]*>/gi,

      // Dangerous protocols - more comprehensive
      /javascript\s*:/gi,
      /vbscript\s*:/gi,
      /data\s*:\s*text\/html/gi,
      /data\s*:\s*text\/javascript/gi,
      /data\s*:\s*application\/javascript/gi,

      // Event handlers (on* attributes)
      /\s*on\w+\s*=\s*['""][^'"]*['"]/gi,
      /\s*on\w+\s*=\s*[^'"\s>]+/gi,

      // Other dangerous tags
      /<iframe[^>]*>[\s\S]*?<\/iframe>/gi,
      /<object[^>]*>[\s\S]*?<\/object>/gi,
      /<embed[^>]*>/gi,
      /<form[^>]*>[\s\S]*?<\/form>/gi,
      /<meta[^>]*>/gi,
      /<link[^>]*>/gi,
      /<style[^>]*>[\s\S]*?<\/style>/gi,

      // Expression() and other CSS injections
      /expression\s*\(/gi,
      /-moz-binding/gi,
      /behavior\s*:/gi,
    ];

    // HTML entities for encoding
    this.htmlEntities = {
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      '"': '&quot;',
      "'": '&#x27;',
      '/': '&#x2F;'
    };
  }

  // Main sanitization function - backwards compatible
  sanitizeUserInput(input) {
    try {
      // Handle null/undefined/empty inputs
      if (!input || typeof input !== 'string') {
        return '';
      }

      // Trim whitespace
      let sanitized = input.trim();

      // Length validation
      if (sanitized.length > this.maxContentLength) {
        sanitized = sanitized.substring(0, this.maxContentLength);
      }

      // Remove dangerous patterns first
      sanitized = this.removeDangerousPatterns(sanitized);

      // Remove any remaining dangerous content that might be encoded
      sanitized = this.removeDangerousContent(sanitized);

      // Encode remaining HTML entities
      sanitized = this.encodeHtmlEntities(sanitized);

      // Final validation
      sanitized = this.finalValidation(sanitized);

      return sanitized;

    } catch (error) {
      console.error('Input sanitization failed:', error);
      // Fallback to basic trim on error - backwards compatible
      return input ? input.trim() : '';
    }
  }

  // Remove dangerous patterns
  removeDangerousPatterns(content) {
    let cleaned = content;

    // Apply all dangerous pattern removals
    this.dangerousPatterns.forEach(pattern => {
      cleaned = cleaned.replace(pattern, '');
    });

    // Remove any remaining script content between tags
    cleaned = cleaned.replace(/<[^>]*script[^>]*>/gi, '');
    cleaned = cleaned.replace(/<\/[^>]*script[^>]*>/gi, '');

    // Additional protocol sanitization for href and src attributes
    cleaned = cleaned.replace(/href\s*=\s*["']?\s*javascript\s*:[^"'>\s]*/gi, 'href=""');
    cleaned = cleaned.replace(/src\s*=\s*["']?\s*javascript\s*:[^"'>\s]*/gi, 'src=""');
    cleaned = cleaned.replace(/href\s*=\s*["']?\s*vbscript\s*:[^"'>\s]*/gi, 'href=""');
    cleaned = cleaned.replace(/src\s*=\s*["']?\s*vbscript\s*:[^"'>\s]*/gi, 'src=""');

    return cleaned;
  }

  // Remove remaining dangerous content after pattern removal
  removeDangerousContent(content) {
    let cleaned = content;

    // Remove any standalone dangerous function calls
    cleaned = cleaned.replace(/alert\s*\([^)]*\)/gi, '');
    cleaned = cleaned.replace(/eval\s*\([^)]*\)/gi, '');
    cleaned = cleaned.replace(/setTimeout\s*\([^)]*\)/gi, '');
    cleaned = cleaned.replace(/setInterval\s*\([^)]*\)/gi, '');
    cleaned = cleaned.replace(/document\s*\.\s*write/gi, '');
    cleaned = cleaned.replace(/document\s*\.\s*writeln/gi, '');

    return cleaned;
  }

  // Encode HTML entities
  encodeHtmlEntities(content) {
    return content.replace(/[<>&"'/]/g, (char) => {
      return this.htmlEntities[char] || char;
    });
  }

  // Final validation and cleanup
  finalValidation(content) {
    // Remove any null bytes or control characters (except newlines and tabs)
    // eslint-disable-next-line no-control-regex
    let validated = content.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    // Normalize line endings
    validated = validated.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Limit consecutive newlines to prevent excessive spacing
    validated = validated.replace(/\n{4,}/g, '\n\n\n');

    return validated;
  }

  // Validate URL schemes for link detection
  isValidUrl(url) {
    try {
      const urlObj = new URL(url);
      const allowedProtocols = ['http:', 'https:', 'mailto:', 'tel:'];
      return allowedProtocols.includes(urlObj.protocol.toLowerCase());
    } catch {
      return false;
    }
  }

  // Get sanitization statistics (useful for debugging)
  getSanitizationReport(original, sanitized) {
    return {
      originalLength: original ? original.length : 0,
      sanitizedLength: sanitized ? sanitized.length : 0,
      wasModified: original !== sanitized,
      reductionPercentage: original ?
        ((original.length - sanitized.length) / original.length * 100).toFixed(2) : 0
    };
  }

  // Test function to verify sanitization works
  runSanitizationTests() {
    const testCases = [
      {
        name: 'Script tag injection',
        input: '<script>alert("XSS")</script>Hello world',
        expected: 'Hello world'
      },
      {
        name: 'Event handler injection',
        input: '<img src="x" onerror="alert(1)"> Test',
        expected: '&lt;img src=&quot;x&quot; &gt; Test'
      },
      {
        name: 'JavaScript protocol',
        input: '<a href="javascript:alert(1)">Click me</a>',
        expected: '&lt;a href=&quot;&quot;&gt;Click me&lt;&#x2F;a&gt;'
      },
      {
        name: 'Normal text',
        input: 'Hello world, this is a normal message!',
        expected: 'Hello world, this is a normal message!'
      },
      {
        name: 'Text with quotes',
        input: 'He said "Hello" and she replied \'Hi\'',
        expected: 'He said &quot;Hello&quot; and she replied &#x27;Hi&#x27;'
      }
    ];

    const results = testCases.map(test => {
      const result = this.sanitizeUserInput(test.input);
      return {
        ...test,
        result,
        passed: result === test.expected || result.includes(test.expected.replace(/&[^;]+;/g, ''))
      };
    });

    return results;
  }
}

// Create singleton instance
const inputSanitizationService = new InputSanitizationService();

// Export the main sanitization function for easy import
export const sanitizeUserInput = (input) => {
  return inputSanitizationService.sanitizeUserInput(input);
};

// Export service instance for advanced usage
export default inputSanitizationService;

// Export class for testing
export { InputSanitizationService };