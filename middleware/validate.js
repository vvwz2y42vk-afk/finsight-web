/**
 * INPUT VALIDATION MIDDLEWARE
 *
 * Problem: Route handlers trust req.body blindly. Malformed or malicious
 *          input can corrupt the database, trigger unhandled exceptions, or
 *          expose internal error messages to attackers.
 *
 * Solution: Composable field-level validators that run before any route
 *           handler. Returns 400 with an Arabic error message on first
 *           failure — never reaches the DB layer.
 *
 * Why not Joi/Zod? No extra dependency. These validators cover 95% of our
 * use-cases (strings, numbers, phone numbers, dates) with <100 lines.
 */

'use strict';

// ── Primitive validators ──────────────────────────────────────────
const v = {
  required: (val) => val !== undefined && val !== null && String(val).trim() !== '',
  string:   (val, min = 0, max = 500) => {
    if (typeof val !== 'string') return false;
    const len = val.trim().length;
    return len >= min && len <= max;
  },
  number:   (val, min = -Infinity, max = Infinity) => {
    const n = Number(val);
    return !isNaN(n) && n >= min && n <= max;
  },
  phone:    (val) => /^\+?[0-9]{9,15}$/.test(String(val || '').replace(/\s/g, '')),
  email:    (val) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(val || '')),
  date:     (val) => !isNaN(Date.parse(val)),
  oneOf:    (val, opts) => opts.includes(val),
  mongo:    (val) => /^[a-f\d]{24}$/i.test(String(val || '')),
};

// ── Schema runner ─────────────────────────────────────────────────
/**
 * Builds an Express middleware from a schema definition.
 * Schema: { fieldName: (value, body) => 'Arabic error message' | null }
 *
 * @param {Object} schema
 * @returns {Function} Express middleware
 */
function validate(schema) {
  return (req, res, next) => {
    for (const [field, check] of Object.entries(schema)) {
      const error = check(req.body[field], req.body);
      if (error) return res.status(400).json({ error });
    }
    next();
  };
}

// ── Reusable schemas ──────────────────────────────────────────────
const schemas = {
  login: {
    username: (val) => !v.required(val) ? 'اسم المستخدم مطلوب' : null,
    password: (val) => !v.required(val) ? 'كلمة المرور مطلوبة' : null,
  },

  booking: {
    apartment: (val) => !v.string(val, 1, 200) ? 'اسم الشقة مطلوب' : null,
    checkIn:   (val) => !v.date(val) ? 'تاريخ الدخول غير صحيح' : null,
    checkOut:  (val, body) => {
      if (!v.date(val)) return 'تاريخ الخروج غير صحيح';
      if (new Date(val) <= new Date(body.checkIn)) return 'تاريخ الخروج يجب أن يكون بعد الدخول';
      return null;
    },
    totalPrice: (val) => val !== undefined && !v.number(val, 0, 10_000_000) ? 'السعر غير صحيح' : null,
  },

  customer: {
    name:  (val) => !v.string(val, 2, 200) ? 'الاسم مطلوب (2-200 حرف)' : null,
    phone: (val) => !v.phone(val) ? 'رقم الجوال غير صحيح' : null,
  },

  staffUser: {
    name:     (val) => !v.string(val, 2, 100) ? 'الاسم مطلوب' : null,
    username: (val) => !v.string(val, 3, 50)  ? 'اسم المستخدم مطلوب (3-50 حرف)' : null,
    password: (val) => !v.string(val, 6, 200) ? 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' : null,
    role:     (val) => !v.oneOf(val, ['admin','manager','staff','cleaner','maintenance'])
                       ? 'الدور الوظيفي غير صحيح' : null,
  },
};

module.exports = { validate, schemas, v };
