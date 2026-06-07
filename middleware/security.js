/**
 * SECURITY MIDDLEWARE STACK
 *
 * Problem: Express ships with zero security headers and no input sanitization.
 *          Without these, the app is vulnerable to XSS, clickjacking, MIME
 *          sniffing, and content-injection attacks.
 *
 * Solution: Helmet-equivalent headers applied at the app level, plus a
 *           sanitizeBody middleware that strips XSS vectors from all incoming
 *           JSON/form payloads before they touch route handlers.
 *
 * Why not use the `helmet` npm package? Avoids adding a dependency for
 * ~30 lines of header logic we control completely.
 */

'use strict';

/**
 * Applies strict security headers to every response.
 * Call once via app.use(securityHeaders) before all routes.
 */
function securityHeaders(req, res, next) {
  // Prevent browsers from MIME-sniffing the content type
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Block the page from being framed (clickjacking defense)
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  // Enable browser XSS auditor (legacy browsers)
  res.setHeader('X-XSS-Protection', '1; mode=block');
  // Strict HTTPS for 1 year in production
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  // Limit what external resources the page can load
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com https://cdn.jsdelivr.net",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: https: blob:",
      "connect-src 'self'",
      "frame-ancestors 'self'",
    ].join('; ')
  );
  // Don't send Referer header when navigating to external sites
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Disable browser features not needed by this app
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // Remove Express fingerprint
  res.removeHeader('X-Powered-By');
  next();
}

/**
 * Recursively strips HTML/script tags from all string values in an object.
 * Applied to req.body before route handlers run.
 *
 * Why recursive: nested objects (e.g. booking.guest.name) must also be cleaned.
 * Why allowlist approach: strip only dangerous patterns, preserve Arabic/unicode text.
 */
function _sanitize(value) {
  if (typeof value === 'string') {
    return value
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '')
      .trim();
  }
  if (Array.isArray(value)) return value.map(_sanitize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = _sanitize(value[k]);
    return out;
  }
  return value;
}

function sanitizeBody(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = _sanitize(req.body);
  }
  next();
}

module.exports = { securityHeaders, sanitizeBody };
