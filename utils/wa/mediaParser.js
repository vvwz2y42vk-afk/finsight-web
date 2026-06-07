/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  MEDIA PARSER & PROXY ENGINE                                    ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  PROBLEM: WhatsApp delivers media via temporary media IDs.      ║
 * ║  The underlying CDN URL expires in ~5 minutes. Storing the      ║
 * ║  raw media ID without downloading means all media goes dark     ║
 * ║  within minutes of receipt.                                     ║
 * ║                                                                 ║
 * ║  SOLUTION: Download-on-ingest pipeline:                         ║
 * ║  1. On webhook receipt, resolve media ID → CDN URL via API      ║
 * ║  2. Download binary buffer immediately                          ║
 * ║  3. Convert to base64 data URI and persist in WaMessage.media   ║
 * ║  4. /api/ws/media/:msgId proxy endpoint serves from DB          ║
 * ║                                                                 ║
 * ║  MIME MAP: Dynamically infers content-type from WhatsApp's      ║
 * ║  mime_type field rather than hardcoding, supporting future      ║
 * ║  media types without code changes.                              ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

'use strict';

const { downloadMedia } = require('../../services/whatsappApi');

/** WhatsApp type → human label (fallback rendering) */
const TYPE_LABELS = {
  image:    '📷 صورة',
  video:    '🎥 فيديو',
  audio:    '🎙️ تسجيل',
  sticker:  '🪄 ملصق',
  document: '📄 ملف',
};

/**
 * Attempt to download and base64-encode a WhatsApp media attachment.
 * Returns a data URI string, or null if download fails.
 *
 * @param {string} type  - WhatsApp media type (image|video|audio|document|sticker)
 * @param {string} mediaId - Meta media ID from webhook payload
 * @returns {Promise<string|null>}
 */
async function parseMedia(type, mediaId) {
  if (!mediaId) return null;
  if (!['image','video','audio','document','sticker'].includes(type)) return null;

  try {
    const { buffer, mimeType } = await downloadMedia(mediaId);
    const b64     = buffer.toString('base64');
    const dataUri = `data:${mimeType};base64,${b64}`;
    console.log(`[Media] downloaded ${type} (${mediaId}) → ${buffer.length} bytes`);
    return dataUri;
  } catch (e) {
    console.warn(`[Media] failed to download ${type} (${mediaId}):`, e.message);
    return null;
  }
}

/**
 * Generate a safe display label for a media message.
 * Used in conversation list previews.
 * @param {string} type
 * @param {string} [caption]
 */
function mediaLabel(type, caption) {
  const label = TYPE_LABELS[type] || `[${type}]`;
  return caption ? `${label}: ${caption}` : label;
}

module.exports = { parseMedia, mediaLabel };
