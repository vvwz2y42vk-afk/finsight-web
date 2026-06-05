const crypto = require('crypto');
const SECRET = process.env.SESSION_SECRET || 'finsight_2026';

function createToken(payload, expiresInHours = 24) {
  const exp = Date.now() + expiresInHours * 60 * 60 * 1000;
  const data = Buffer.from(JSON.stringify({ ...payload, exp })).toString('base64');
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
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64').toString());
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch { return null; }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'غير مسموح لدورك الوظيفي' });
    }
    next();
  };
}

module.exports = { createToken, verifyToken, requireRole };
