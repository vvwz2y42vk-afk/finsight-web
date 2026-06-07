/**
 * EXPONENTIAL BACKOFF RETRY UTILITY
 *
 * Problem: External API calls (Resend email, Gemini AI, future integrations)
 *          fail transiently — network blips, rate limits, cold starts.
 *          Without retry logic, one transient failure means a lost email or
 *          a broken user-facing feature.
 *
 * Solution: Exponential backoff with jitter. Each retry waits 2^attempt * base
 *           milliseconds, plus random jitter to prevent thundering-herd when
 *           many requests fail at the same time.
 *
 * Alternatives considered:
 *   - p-retry (npm): good, but adds a dependency for ~40 lines of logic.
 *   - axios-retry: axios-specific, we use fetch/node http.
 */

'use strict';

/**
 * Retries an async function with exponential backoff.
 *
 * @param {Function} fn          - Async function to call. Must throw on failure.
 * @param {Object}   [opts]
 * @param {number}   [opts.retries=3]    - Max retry attempts after first failure.
 * @param {number}   [opts.baseMs=300]   - Base delay in milliseconds.
 * @param {number}   [opts.maxMs=10000]  - Cap on delay per attempt.
 * @param {Function} [opts.shouldRetry]  - (error) => boolean. Default: always retry.
 * @param {string}   [opts.label='']     - Log prefix for debugging.
 * @returns {Promise<*>} Result of fn on success.
 * @throws  Last error after all retries exhausted.
 */
async function withRetry(fn, {
  retries     = 3,
  baseMs      = 300,
  maxMs       = 10_000,
  shouldRetry = () => true,
  label       = '',
} = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isLast = attempt === retries;
      if (isLast || !shouldRetry(err)) throw err;

      const jitter  = Math.random() * baseMs;
      const delay   = Math.min(baseMs * Math.pow(2, attempt) + jitter, maxMs);
      console.warn(`[retry${label ? ':' + label : ''}] attempt ${attempt + 1} failed: ${err.message} — retrying in ${Math.round(delay)}ms`);
      await _sleep(delay);
    }
  }
  throw lastErr;
}

/**
 * Retries only on specific HTTP status codes (429 rate-limit, 5xx server errors).
 * Pass as opts.shouldRetry when wrapping fetch calls.
 */
function retryOnTransient(err) {
  const status = err?.status || err?.statusCode || err?.response?.status;
  if (!status) return true; // network error — always retry
  return status === 429 || (status >= 500 && status < 600);
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { withRetry, retryOnTransient };
