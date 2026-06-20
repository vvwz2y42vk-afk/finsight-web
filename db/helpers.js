const { db } = require('./index');
const { eq, and, or, ne, gt, gte, lt, lte, isNull, isNotNull,
        inArray, notInArray, like, ilike, desc, asc, sql,
        count, sum, avg } = require('drizzle-orm');
const crypto  = require('crypto');
const bcrypt  = require('bcryptjs');

// ─── ID generation (24-char hex, same format as MongoDB ObjectId) ─
function newId() { return crypto.randomBytes(12).toString('hex'); }

// ─── Password helpers ─────────────────────────────────────
async function hashPassword(plain) { return bcrypt.hash(plain, 10); }
async function checkPassword(plain, hash) { return bcrypt.compare(plain, hash); }

// ─── Condition builders ───────────────────────────────────
// Usage: where(t => [eq(t.building, 'x'), isNull(t.propertyId)])
function buildAnd(conditions) {
  const valid = conditions.filter(Boolean);
  if (!valid.length) return undefined;
  return valid.length === 1 ? valid[0] : and(...valid);
}

// ─── Common queries ───────────────────────────────────────
async function findOne(table, conditions) {
  const [row] = await db.select().from(table).where(buildAnd(conditions)).limit(1);
  return row || null;
}

async function findById(table, id) {
  const [row] = await db.select().from(table).where(eq(table.id, id)).limit(1);
  return row || null;
}

async function findMany(table, conditions = [], opts = {}) {
  let q = db.select().from(table);
  const w = buildAnd(conditions);
  if (w) q = q.where(w);
  if (opts.orderBy) q = q.orderBy(opts.orderBy);
  if (opts.limit)   q = q.limit(opts.limit);
  if (opts.offset)  q = q.offset(opts.offset);
  return q;
}

async function countRows(table, conditions = []) {
  const w = buildAnd(conditions);
  let q = db.select({ c: count() }).from(table);
  if (w) q = q.where(w);
  const [r] = await q;
  return Number(r?.c || 0);
}

async function insertOne(table, data) {
  const id = data.id || newId();
  const now = new Date();
  const [row] = await db.insert(table).values({
    ...data, id,
    createdAt: data.createdAt || now,
    updatedAt: data.updatedAt || now,
  }).returning();
  return row;
}

async function updateOne(table, conditions, data) {
  const w = buildAnd(conditions);
  const [row] = await db.update(table)
    .set({ ...data, updatedAt: new Date() })
    .where(w)
    .returning();
  return row || null;
}

async function updateById(table, id, data) {
  return updateOne(table, [eq(table.id, id)], data);
}

async function deleteOne(table, conditions) {
  const w = buildAnd(conditions);
  const [row] = await db.delete(table).where(w).returning();
  return row || null;
}

async function deleteById(table, id) {
  return deleteOne(table, [eq(table.id, id)]);
}

async function upsertOne(table, matchConditions, data) {
  const existing = await findOne(table, matchConditions);
  if (existing) return updateOne(table, [eq(table.id, existing.id)], data);
  return insertOne(table, data);
}

// ─── Raw SQL helper ───────────────────────────────────────
async function rawQuery(query, params = []) {
  const { neon } = require('@neondatabase/serverless');
  const s = neon(process.env.DATABASE_URL);
  return s.query(query, params);
}

module.exports = {
  newId, hashPassword, checkPassword,
  buildAnd, eq, and, or, ne, gt, gte, lt, lte,
  isNull, isNotNull, inArray, notInArray, like, ilike,
  desc, asc, sql, count, sum, avg,
  findOne, findById, findMany, countRows,
  insertOne, updateOne, updateById, deleteOne, deleteById,
  upsertOne, rawQuery,
};
