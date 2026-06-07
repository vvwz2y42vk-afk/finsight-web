/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  WEBHOOK HANDLER SERVICE — DEDUPLICATION ENGINE                 ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  PROBLEM: WhatsApp retries webhook delivery on any non-200      ║
 * ║  response or network timeout, producing duplicate payloads.     ║
 * ║                                                                 ║
 * ║  SOLUTION: Two-layer idempotency guard:                         ║
 * ║  1. MongoDB unique sparse index on waMessageId (E11000 = dup)   ║
 * ║  2. In-memory LRU Set for ultra-fast hot-path dedup (< 5ms)     ║
 * ║     before any DB round-trip on recently-seen IDs.              ║
 * ║                                                                 ║
 * ║  MEDIA INTERCEPTION: On inbound media, this handler delegates   ║
 * ║  immediately to mediaParser to download the buffer before the   ║
 * ║  temporary Meta media URL expires (~5 min TTL).                 ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

'use strict';

const WaMessage   = require('../models/WaMessage');
const { parseMedia } = require('../utils/wa/mediaParser');

// In-memory hot dedup set — evict after 10 min, max 5000 entries
const _seen = new Map(); // messageId → timestamp
const SEEN_TTL = 10 * 60 * 1000;
const SEEN_MAX = 5000;

function _markSeen(id) {
  if (_seen.size >= SEEN_MAX) {
    const oldest = _seen.keys().next().value;
    _seen.delete(oldest);
  }
  _seen.set(id, Date.now());
}

function _isDuplicate(id) {
  const ts = _seen.get(id);
  if (!ts) return false;
  if (Date.now() - ts > SEEN_TTL) { _seen.delete(id); return false; }
  return true;
}

/**
 * Process a verified Meta webhook payload.
 * Fire-and-forget safe — caller does NOT await.
 * @param {object} body - Raw parsed webhook body from Meta
 * @param {string} ownPhone - Our business phone (966XXXXXXXXX)
 */
async function processWebhook(body, ownPhone) {
  try {
    const changes = body?.entry?.[0]?.changes || [];
    for (const change of changes) {
      const val = change?.value;
      if (!val) continue;

      // Status updates (delivery/read receipts) — log only, no DB write
      if (val.statuses?.length) {
        for (const s of val.statuses) {
          console.log(`[WH] status ${s.status} for msg ${s.id} to ${s.recipient_id}`);
        }
      }

      // Inbound messages
      if (val.messages?.length) {
        for (const msg of val.messages) {
          await _processMessage(msg, val.contacts || [], ownPhone);
        }
      }
    }
  } catch (e) {
    console.error('[WH] processWebhook error:', e.message);
  }
}

async function _processMessage(msg, contacts, ownPhone) {
  const msgId = msg.id;

  // Layer 1: hot dedup
  if (_isDuplicate(msgId)) {
    console.log('[WH] hot-dedup discarded:', msgId);
    return;
  }
  _markSeen(msgId);

  const contact  = contacts.find(c => c.wa_id === msg.from);
  const fromName = contact?.profile?.name || null;
  const sentAt   = new Date(Number(msg.timestamp) * 1000);

  let body    = '';
  let msgType = msg.type;
  let mediaUrl = null;

  if (msg.type === 'text') {
    body = msg.text?.body || '';
  } else if (['image','document','audio','video','sticker'].includes(msg.type)) {
    const mediaObj = msg[msg.type];
    body    = mediaObj?.caption || mediaObj?.filename || `[${msg.type}]`;
    // Async media download — non-blocking
    parseMedia(msg.type, mediaObj?.id).then(url => {
      if (url) WaMessage.findOneAndUpdate({ waMessageId: msgId }, { mediaUrl: url }).catch(() => {});
    }).catch(() => {});
  } else if (msg.type === 'location') {
    body = `[موقع: ${msg.location?.latitude},${msg.location?.longitude}]`;
  } else if (msg.type === 'interactive') {
    body = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || '[تفاعل]';
  } else {
    body = `[${msg.type}]`;
  }

  try {
    await WaMessage.create({
      waMessageId: msgId,
      from: msg.from,
      fromName,
      to: ownPhone,
      body,
      direction: 'in',
      msgType,
      mediaUrl,
      sentAt,
      read: false,
    });
    console.log(`[WH] saved inbound ${msgType} from ${msg.from}: "${body.slice(0,60)}"`);
  } catch (e) {
    // Layer 2: DB-level dedup (E11000 = duplicate key)
    if (e.code === 11000) {
      console.log('[WH] db-dedup discarded:', msgId);
    } else {
      console.error('[WH] save error:', e.message);
    }
  }
}

module.exports = { processWebhook };
