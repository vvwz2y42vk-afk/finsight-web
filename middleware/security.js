/**
 * SECURITY MIDDLEWARE STACK
 *
 * Problem: Express ships with zero security headers, no input sanitization,
 *          and no protection against MongoDB operator injection.
 *
 * Solution: Three layers of defense applied before any route handler:
 *   1. securityHeaders   — HTTP-level browser protections (CSP, HSTS, etc.)
 *   2. sanitizeBody      — XSS vector stripping from req.body
 *   3. noSQLGuard        — Strips MongoDB operators ($ne, $gt, $where…) from
 *                          req.body AND req.query to prevent NoSQL injection.
 *                          e.g. ?status[$ne]=x would bypass all DB filters.
 *
 * Why not use `helmet`? Avoids a dependency for ~30 lines we fully control.
 * Why not use `mongo-sanitize`? Same reason — and we need it on query params too.
 */

'use strict';

// ── 1. Security Headers ───────────────────────────────────────────
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
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
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.removeHeader('X-Powered-By');
  next();
}

// ── 2. XSS Sanitization ───────────────────────────────────────────
function _stripXSS(value) {
  if (typeof value === 'string') {
    return value
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '')
      .trim();
  }
  if (Array.isArray(value)) return value.map(_stripXSS);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = _stripXSS(value[k]);
    return out;
  }
  return value;
}

function sanitizeBody(req, res, next) {
  if (req.body && typeof req.body === 'object') req.body = _stripXSS(req.body);
  next();
}

// ── 3. NoSQL Injection Guard ──────────────────────────────────────
// Recursively removes any key that starts with $ (MongoDB operator).
// Also coerces object values in query params to strings (prevents ?x[$ne]=y).
function _stripMongoOps(obj) {
  if (Array.isArray(obj)) return obj.map(_stripMongoOps);
  if (obj && typeof obj === 'object') {
    const clean = {};
    for (const k of Object.keys(obj)) {
      if (k.startsWith('$')) continue;           // drop $ne, $gt, $where, etc.
      if (k.startsWith('\x00')) continue;        // drop null-byte keys
      clean[k] = _stripMongoOps(obj[k]);
    }
    return clean;
  }
  return obj;
}

function noSQLGuard(req, res, next) {
  if (req.body  && typeof req.body  === 'object') req.body  = _stripMongoOps(req.body);
  if (req.query && typeof req.query === 'object') req.query = _stripMongoOps(req.query);
  if (req.params && typeof req.params === 'object') {
    // Params are path segments — coerce to string, reject obvious injection
    for (const k of Object.keys(req.params)) {
      const v = req.params[k];
      if (typeof v === 'object') {
        return res.status(400).json({ error: 'طلب غير صحيح' });
      }
      // MongoDB IDs must be 24-char hex — reject anything else in :id params
      if (k === 'id' && !/^[a-f\d]{24}$/i.test(String(v))) {
        return res.status(400).json({ error: 'معرّف غير صحيح' });
      }
    }
  }
  next();
}

module.exports = { securityHeaders, sanitizeBody, noSQLGuard };
