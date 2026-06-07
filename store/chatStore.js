/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  CHAT STORE — CONCURRENCY & THREAD LOCK MANAGER                 ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  PROBLEM: In a multi-agent environment, two agents can open      ║
 * ║  the same conversation simultaneously, both typing replies.     ║
 * ║  This causes duplicate replies, confused guests, and broken     ║
 * ║  conversation context.                                          ║
 * ║                                                                 ║
 * ║  SOLUTION: In-memory lock registry with TTL auto-expiry.        ║
 * ║  Each conversation phone maps to a Lock object:                 ║
 * ║    { isLocked, assignedAgentId, agentName,                      ║
 * ║      agentTypingStatus, lockedAt, expiresAt }                   ║
 * ║                                                                 ║
 * ║  Locks auto-expire after LOCK_TTL ms of inactivity.            ║
 * ║  Typing heartbeat resets the expiry timer.                      ║
 * ║  All state is broadcast via SSE to connected agents.            ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

'use strict';

const LOCK_TTL     = 5 * 60 * 1000;  // 5 min inactivity → auto-release
const TYPING_TTL   = 8 * 1000;       // 8 sec typing indicator auto-clear

/** @type {Map<string, LockState>} phone → lock */
const _locks = new Map();

/** @type {Set<{res: import('express').Response, agentId: string}>} SSE clients */
const _sseClients = new Set();

/**
 * @typedef {Object} LockState
 * @property {boolean} isLocked
 * @property {string|null} assignedAgentId
 * @property {string|null} agentName
 * @property {boolean} agentTypingStatus
 * @property {number} lockedAt
 * @property {number} expiresAt
 * @property {NodeJS.Timeout|null} _expireTimer
 * @property {NodeJS.Timeout|null} _typingTimer
 */

function _getLock(phone) {
  return _locks.get(phone) || { isLocked: false, assignedAgentId: null, agentName: null, agentTypingStatus: false, lockedAt: 0, expiresAt: 0 };
}

function _setLock(phone, patch) {
  const current = _getLock(phone);
  const next    = { ...current, ...patch };
  _locks.set(phone, next);
  _broadcast({ type: 'lock_update', phone, state: _safeState(next) });
}

function _safeState(lock) {
  return {
    isLocked:          lock.isLocked,
    assignedAgentId:   lock.assignedAgentId,
    agentName:         lock.agentName,
    agentTypingStatus: lock.agentTypingStatus,
    lockedAt:          lock.lockedAt,
    expiresAt:         lock.expiresAt,
  };
}

/**
 * Attempt to acquire a conversation lock.
 * @param {string} phone
 * @param {string} agentId
 * @param {string} agentName
 * @returns {{ ok: boolean, heldBy?: string }}
 */
function acquireLock(phone, agentId, agentName) {
  const current = _getLock(phone);

  // Already locked by someone else and not expired
  if (current.isLocked && current.assignedAgentId !== agentId && Date.now() < current.expiresAt) {
    return { ok: false, heldBy: current.agentName || current.assignedAgentId };
  }

  // Clear old timers
  if (current._expireTimer) clearTimeout(current._expireTimer);

  const now   = Date.now();
  const timer = setTimeout(() => releaseLock(phone, agentId, true), LOCK_TTL);

  _locks.set(phone, {
    isLocked:          true,
    assignedAgentId:   agentId,
    agentName,
    agentTypingStatus: false,
    lockedAt:          now,
    expiresAt:         now + LOCK_TTL,
    _expireTimer:      timer,
    _typingTimer:      null,
  });

  _broadcast({ type: 'lock_update', phone, state: _safeState(_locks.get(phone)) });
  return { ok: true };
}

/**
 * Release a lock.
 * @param {string} phone
 * @param {string} agentId
 * @param {boolean} [force] - bypass ownership check
 */
function releaseLock(phone, agentId, force = false) {
  const current = _getLock(phone);
  if (!force && current.assignedAgentId !== agentId) return false;

  if (current._expireTimer) clearTimeout(current._expireTimer);
  if (current._typingTimer) clearTimeout(current._typingTimer);

  _locks.delete(phone);
  _broadcast({ type: 'lock_update', phone, state: { isLocked: false, assignedAgentId: null, agentName: null, agentTypingStatus: false } });
  return true;
}

/**
 * Set/clear typing indicator for a conversation.
 * Also heartbeats the lock TTL.
 */
function setTyping(phone, agentId, isTyping) {
  const current = _locks.get(phone);
  if (!current || current.assignedAgentId !== agentId) return;

  if (current._typingTimer) clearTimeout(current._typingTimer);
  if (current._expireTimer) clearTimeout(current._expireTimer);

  const now     = Date.now();
  const expTimer = setTimeout(() => releaseLock(phone, agentId, true), LOCK_TTL);
  let   typTimer = null;

  if (isTyping) {
    typTimer = setTimeout(() => setTyping(phone, agentId, false), TYPING_TTL);
  }

  _locks.set(phone, { ...current, agentTypingStatus: isTyping, expiresAt: now + LOCK_TTL, _expireTimer: expTimer, _typingTimer: typTimer });
  _broadcast({ type: 'typing', phone, agentId, isTyping });
}

/**
 * Get all current lock states as a snapshot.
 * @returns {Object}
 */
function getSnapshot() {
  const out = {};
  for (const [phone, lock] of _locks) {
    out[phone] = _safeState(lock);
  }
  return out;
}

// ── SSE Broadcast ─────────────────────────────────────────────────

function addSSEClient(res, agentId) {
  const client = { res, agentId };
  _sseClients.add(client);
  // Send current snapshot immediately on connect
  _sendSSE(res, { type: 'snapshot', locks: getSnapshot() });
  return () => _sseClients.delete(client);
}

function _broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of _sseClients) {
    try { client.res.write(data); } catch { _sseClients.delete(client); }
  }
}

function _sendSSE(res, event) {
  try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch {}
}

/** Broadcast a new inbound message event to all connected agents. */
function broadcastNewMessage(phone, msg) {
  _broadcast({ type: 'new_message', phone, msg });
}

module.exports = { acquireLock, releaseLock, setTyping, getSnapshot, addSSEClient, broadcastNewMessage };
