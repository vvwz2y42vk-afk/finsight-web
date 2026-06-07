/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  WHATSAPP API SERVICE — TOKEN BUCKET RATE LIMITER               ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  PROBLEM: WhatsApp Cloud API enforces per-second rate limits.   ║
 * ║  Bursting above threshold degrades quality rating (GREEN →      ║
 * ║  YELLOW → RED) and risks number ban.                            ║
 * ║                                                                 ║
 * ║  SOLUTION: Token Bucket Algorithm                               ║
 * ║  - Bucket capacity: 20 tokens (burst allowance)                 ║
 * ║  - Refill: 10 tokens/second (sustained throughput)              ║
 * ║  - Each outbound message costs 1 token                          ║
 * ║  - Messages arriving when bucket is empty enter FIFO queue      ║
 * ║  - Queue drains as tokens refill — transparent to callers       ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

'use strict';

const PHONE_ID = () => process.env.WHATSAPP_PHONE_ID;
const TOKEN    = () => process.env.WHATSAPP_TOKEN;
const API_BASE = 'https://graph.facebook.com/v21.0';

// ── Token Bucket State ────────────────────────────────────────────
const BUCKET_CAPACITY = 20;
const REFILL_RATE     = 10; // tokens per second
let   _tokens         = BUCKET_CAPACITY;
let   _lastRefill     = Date.now();
const _queue          = []; // { payload, resolve, reject }
let   _draining       = false;

function _refill() {
  const now  = Date.now();
  const delta = (now - _lastRefill) / 1000;
  _tokens     = Math.min(BUCKET_CAPACITY, _tokens + delta * REFILL_RATE);
  _lastRefill = now;
}

async function _drain() {
  if (_draining) return;
  _draining = true;
  while (_queue.length > 0) {
    _refill();
    if (_tokens < 1) {
      await new Promise(r => setTimeout(r, Math.ceil((1 - _tokens) / REFILL_RATE * 1000)));
      continue;
    }
    _tokens -= 1;
    const job = _queue.shift();
    try {
      const result = await _callApi(job.payload);
      job.resolve(result);
    } catch (e) {
      job.reject(e);
    }
  }
  _draining = false;
}

function _enqueue(payload) {
  return new Promise((resolve, reject) => {
    _refill();
    if (_tokens >= 1) {
      _tokens -= 1;
      _callApi(payload).then(resolve).catch(reject);
    } else {
      _queue.push({ payload, resolve, reject });
      _drain();
    }
  });
}

async function _callApi(payload) {
  const phId = PHONE_ID();
  const tok  = TOKEN();
  if (!phId || !tok) throw new Error('WHATSAPP_PHONE_ID or WHATSAPP_TOKEN missing');

  const res  = await fetch(`${API_BASE}/${phId}/messages`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error?.message || 'WhatsApp API error');
    err.code  = data.error?.code;
    err.data  = data;
    throw err;
  }
  return data;
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Send a plain text message.
 * @param {string} to - Recipient E.164 without +
 * @param {string} text
 * @returns {Promise<{messageId: string}>}
 */
async function sendText(to, text) {
  const data = await _enqueue({
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to:                formatPhone(to),
    type:              'text',
    text:              { body: text, preview_url: false },
  });
  return { messageId: data.messages?.[0]?.id };
}

/**
 * Send an approved template message.
 * @param {string} to
 * @param {string} templateName
 * @param {string[]} params - Body component parameters
 */
async function sendTemplate(to, templateName, params) {
  const data = await _enqueue({
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to:                formatPhone(to),
    type:              'template',
    template: {
      name:       templateName,
      language:   { code: 'ar' },
      components: [{
        type:       'body',
        parameters: params.map(p => ({ type: 'text', text: String(p) })),
      }],
    },
  });
  return { messageId: data.messages?.[0]?.id };
}

/**
 * Mark a message as read (blue ticks).
 * @param {string} messageId
 */
async function markRead(messageId) {
  const phId = PHONE_ID();
  const tok  = TOKEN();
  if (!phId || !tok) return;
  fetch(`${API_BASE}/${phId}/messages`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId }),
  }).catch(() => {});
}

/**
 * Download media binary from Meta's CDN.
 * @param {string} mediaId
 * @returns {Promise<{buffer: Buffer, mimeType: string, ext: string}>}
 */
async function downloadMedia(mediaId) {
  const tok = TOKEN();
  // Step 1: resolve media URL
  const metaRes = await fetch(`${API_BASE}/${mediaId}`, {
    headers: { 'Authorization': `Bearer ${tok}` },
  });
  if (!metaRes.ok) throw new Error('Media metadata fetch failed');
  const meta = await metaRes.json();

  // Step 2: download binary
  const binRes = await fetch(meta.url, {
    headers: { 'Authorization': `Bearer ${tok}` },
  });
  if (!binRes.ok) throw new Error('Media binary fetch failed');
  const buffer   = Buffer.from(await binRes.arrayBuffer());
  const mimeType = meta.mime_type || 'application/octet-stream';
  const ext      = mimeType.split('/')[1]?.split(';')[0] || 'bin';
  return { buffer, mimeType, ext };
}

function formatPhone(phone) {
  const clean = (phone || '').replace(/\D/g, '');
  if (clean.startsWith('966')) return clean;
  if (clean.startsWith('05'))  return '966' + clean.slice(1);
  if (clean.startsWith('5'))   return '966' + clean;
  return clean;
}

module.exports = { sendText, sendTemplate, markRead, downloadMedia, formatPhone };
