/**
 * SECURITY AUDIT LOGGER
 *
 * Problem: Failed logins and unauthorized access attempts are invisible.
 *          Without a security log, brute-force attacks and privilege
 *          escalation attempts go undetected until damage is done.
 *
 * Solution: Persists security events to the AuditLog collection with IP,
 *           timestamp, user-agent, and event type. Kept separate from the
 *           functional AuditLog writes so security events are never silenced
 *           by a catch() in business logic.
 *
 * Events logged:
 *   - LOGIN_FAIL        : wrong credentials
 *   - LOGIN_SUCCESS     : successful login (for correlation)
 *   - UNAUTHORIZED      : request with no valid session token
 *   - FORBIDDEN         : valid session but insufficient role
 *   - NOSQL_ATTEMPT     : request body/query contained MongoDB operators
 */

'use strict';

const mongoose = require('mongoose');

// Minimal inline schema — avoids circular require with models/AuditLog.js
// Uses the same collection so security events appear in the admin audit log.
let _AuditLog;
function getModel() {
  if (_AuditLog) return _AuditLog;
  try {
    _AuditLog = mongoose.model('AuditLog');
  } catch {
    const s = new mongoose.Schema({
      user: String, role: String, action: String, model: String,
      recordId: String, summary: String, ip: String, meta: mongoose.Schema.Types.Mixed,
    }, { timestamps: true });
    _AuditLog = mongoose.model('AuditLog', s);
  }
  return _AuditLog;
}

function _ip(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.socket?.remoteAddress
      || 'unknown';
}

function _ua(req) {
  return (req.headers['user-agent'] || '').slice(0, 200);
}

/**
 * Writes a security event to AuditLog. Fire-and-forget — never throws.
 */
function logSecEvent(type, req, extra = {}) {
  try {
    const Model = getModel();
    Model.create({
      user:    extra.username || req.user?.username || req.staff?.username || 'anonymous',
      role:    'security',
      action:  type,
      model:   'Security',
      recordId: _ip(req),
      summary: extra.summary || type,
      ip:      _ip(req),
      meta:    { ua: _ua(req), path: req.path, method: req.method, ...extra },
    }).catch(() => {});
  } catch {}
}

/**
 * Express middleware: intercepts responses and logs 401/403 automatically.
 * Mount once after session/auth middleware but before routes:
 *   app.use(securityAuditInterceptor)
 */
function securityAuditInterceptor(req, res, next) {
  const _json = res.json.bind(res);
  res.json = function (body) {
    if (res.statusCode === 401) {
      logSecEvent('UNAUTHORIZED', req, { summary: `401 على ${req.method} ${req.path}` });
    } else if (res.statusCode === 403) {
      logSecEvent('FORBIDDEN', req, { summary: `403 على ${req.method} ${req.path}` });
    }
    return _json(body);
  };
  next();
}

module.exports = { logSecEvent, securityAuditInterceptor };
