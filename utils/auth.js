const crypto = require('crypto');
const SECRET = process.env.SESSION_SECRET || 'finsight_2026';

function createToken(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64');
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('hex');
  return `${data}.${sig}`;
}

function verifyToken(token) {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', SECRET).update(data).digest('hex');
  if (sig !== expected) return null;
  try { return JSON.parse(Buffer.from(data, 'base64').toString()); }
  catch { return null; }
}

module.exports = { createToken, verifyToken };
