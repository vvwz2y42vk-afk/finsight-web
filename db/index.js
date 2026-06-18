const { neon } = require('@neondatabase/serverless');
const { drizzle } = require('drizzle-orm/neon-http');
const schema = require('./schema');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL غير محدد في متغيرات البيئة');

const sql = neon(DATABASE_URL);
const db  = drizzle(sql, { schema });

module.exports = { db, sql };
