function createRateLimiter({ windowMs = 15 * 60 * 1000, max = 100, message = 'طلبات كثيرة جداً، حاول لاحقاً' } = {}) {
  const store = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now - entry.first > windowMs) store.delete(key);
    }
  }, windowMs);

  return (req, res, next) => {
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = store.get(key) || { count: 0, first: now };
    if (now - entry.first > windowMs) {
      store.set(key, { count: 1, first: now });
      return next();
    }
    entry.count++;
    store.set(key, entry);
    if (entry.count > max) return res.status(429).json({ error: message });
    next();
  };
}

module.exports = { createRateLimiter };
