#!/usr/bin/env node
/**
 * ترحيل البيانات من MongoDB إلى Neon (PostgreSQL)
 * الاستخدام: node scripts/mongo-to-neon.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { neon } = require('@neondatabase/serverless');

const MONGO_URI    = process.env.MONGO_URI;
const DATABASE_URL = process.env.DATABASE_URL;

if (!MONGO_URI || !DATABASE_URL) {
  console.error('❌ يجب تحديد MONGO_URI و DATABASE_URL في .env');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

// تحويل ObjectId لنص
function id(v) { return v ? v.toString() : null; }
function num(v) { return v != null ? Number(v) || 0 : null; }
function dt(v)  { return v instanceof Date ? v : (v ? new Date(v) : null); }
function bool(v, def = false) { return v != null ? Boolean(v) : def; }
function jsonb(v) { return v != null ? JSON.stringify(v) : null; }

function pad(s, n) { return String(s).padEnd(n); }
function fmt(n)    { return n.toLocaleString(); }

// INSERT أو SKIP على تعارض
async function upsert(table, rows) {
  if (!rows.length) return 0;
  const BATCH = 200;
  let count = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const cols = Object.keys(chunk[0]);
    const colsQ = cols.map(c => `"${c}"`).join(',');
    const placeholders = chunk.map((_, ri) =>
      '(' + cols.map((__, ci) => `$${ri * cols.length + ci + 1}`).join(',') + ')'
    ).join(',');
    const values = chunk.flatMap(r => cols.map(c => r[c]));
    await sql.query(`INSERT INTO ${table} (${colsQ}) VALUES ${placeholders} ON CONFLICT DO NOTHING`, values);
    count += chunk.length;
  }
  return count;
}

async function migrate(label, table, mongoCollection, mapFn) {
  const col = mongoose.connection.db.collection(mongoCollection);
  const total = await col.countDocuments();
  if (total === 0) { console.log(`  ${pad(label,26)} — فارغة`); return; }

  const docs = await col.find({}).toArray();
  const rows = docs.map(mapFn).filter(Boolean);
  const inserted = await upsert(table, rows);
  console.log(`  ${pad(label,26)} — ✓ ${fmt(inserted)}/${fmt(total)}`);
}

(async () => {
  console.log('\n🚀 ترحيل MongoDB → Neon\n');

  await mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 20000, socketTimeoutMS: 60000, family: 4, tls: true,
  });
  console.log('✅ متصل بـ MongoDB\n');

  const start = Date.now();

  await migrate('AdminUser', 'admin_users', 'adminusers', d => ({
    id: id(d._id), name: d.name||'', username: d.username||'',
    password: d.password||'', role: d.role||'employee', avatar: d.avatar||null,
    allowed: jsonb(d.allowed||[]), active: bool(d.active, true),
    created_at: dt(d.createdAt), updated_at: dt(d.updatedAt),
  }));

  await migrate('StaffUser', 'staff_users', 'staffusers', d => ({
    id: id(d._id), name: d.name||'', username: d.username||'',
    password: d.password||'', building: d.building||null, role: d.role||'receptionist',
    active: bool(d.active, true), permissions: jsonb(d.permissions||[]),
    property_id: id(d.propertyId), reset_token: d.resetToken||null,
    reset_token_expiry: dt(d.resetTokenExpiry),
    created_at: dt(d.createdAt), updated_at: dt(d.updatedAt),
  }));

  await migrate('Customer', 'customers', 'customers', d => ({
    id: id(d._id), name: d.name||'', phone: d.phone||'',
    password: d.password||'', email: d.email||null, national_id: d.nationalId||null,
    nationality: d.nationality||'سعودي', notes: d.notes||'',
    reset_token: d.resetToken||null, reset_token_expiry: dt(d.resetTokenExpiry),
    created_at: dt(d.createdAt), updated_at: dt(d.updatedAt),
  }));

  await migrate('Host', 'hosts', 'hosts', d => ({
    id: id(d._id), name: d.name||'', phone: d.phone||'',
    password: d.password||'', email: d.email||null, national_id: d.nationalId||null,
    nationality: d.nationality||null, status: d.status||'pending',
    created_at: dt(d.createdAt), updated_at: dt(d.updatedAt),
  }));

  await migrate('Property', 'properties', 'properties', d => ({
    id: id(d._id), name: d.name||'', type: d.type||null, city: d.city||null,
    phone: d.phone||null, admin_email: d.adminEmail||null,
    buildings: jsonb(d.buildings||[]), plan: d.plan||'trial',
    plan_expiry: dt(d.planExpiry), active: bool(d.active, true),
    created_at: dt(d.createdAt), updated_at: dt(d.updatedAt),
  }));

  await migrate('Booking', 'bookings', 'bookings', d => ({
    id: id(d._id), name: d.name||null, phone: d.phone||null, email: d.email||null,
    building: d.building||null, apt: d.apt||null, listing_title: d.listingTitle||null,
    listing: id(d.listing), booking_type: d.bookingType||'daily', status: d.status||'pending',
    check_in: dt(d.checkIn), check_out: dt(d.checkOut),
    nights: d.nights||0, guests: d.guests||1,
    total_price: num(d.totalPrice), paid_amount: num(d.paidAmount),
    payments: jsonb(d.payments||[]), payment_method: d.paymentMethod||'',
    id_type: d.idType||'', id_number: d.idNumber||null,
    companions: jsonb(d.companions||[]), source: d.source||null,
    property_id: id(d.propertyId), price_per_night: num(d.pricePerNight)||null,
    price_per_month: num(d.pricePerMonth)||null, notes: d.notes||null,
    created_by: d.createdBy||null,
    created_at: dt(d.createdAt), updated_at: dt(d.updatedAt),
  }));

  await migrate('Contract', 'contracts', 'contracts', d => ({
    id: id(d._id), mongo_id: id(d.id)||id(d._id),
    n: d.n||null, sheet: d.sheet||null, a: d.a||null,
    v: num(d.v)||null, p: num(d.p)||null, r: num(d.r)||null,
    en: dt(d.en), ex: dt(d.ex), ph: d.ph||null, st: d.st||null,
    py: d.py||null, src: d.src||null, type: d.type||null,
    notes: d.notes||null, ej: d.ej||null, pm: d.pm||null,
    created_at: dt(d.createdAt), updated_at: dt(d.updatedAt),
  }));

  await migrate('Listing', 'listings', 'listings', d => ({
    id: id(d._id), category: d.category||null, building: d.building||null,
    apt: d.apt||null, floor: d.floor||null, location: d.location||null,
    title: d.title||null, description: d.description||null, type: d.type||'daily',
    price_daily: num(d.price_daily)||null, price_annual: num(d.price_annual)||null,
    price_sale: num(d.price_sale)||null, bedrooms: d.bedrooms||null,
    bathrooms: d.bathrooms||null, area: num(d.area)||null,
    max_guests: d.maxGuests||null, amenities: jsonb(d.amenities||[]),
    photos: jsonb(d.photos||[]), available: bool(d.available, true),
    featured: bool(d.featured, false), blocked_ranges: jsonb(d.blockedRanges||[]),
    host: id(d.host),
    created_at: dt(d.createdAt), updated_at: dt(d.updatedAt),
  }));

  await migrate('Guest', 'guests', 'guests', d => ({
    id: id(d._id), name: d.name||null, phone: d.phone||null,
    id_type: d.idType||null, id_number: d.idNumber||null,
    nationality: d.nationality||null, email: d.email||null,
    building: d.building||null, category: d.category||'regular',
    total_bookings: d.totalBookings||0, last_seen: dt(d.lastSeen),
    property_id: id(d.propertyId), notes: d.notes||null,
    created_at: dt(d.createdAt), updated_at: dt(d.updatedAt),
  }));

  await migrate('Voucher', 'vouchers', 'vouchers', d => ({
    id: id(d._id), building: d.building||null, type: d.type||null,
    number: d.number||null, date: dt(d.date), name: d.name||null,
    phone: d.phone||null, apt: d.apt||null, amount: num(d.amount)||0,
    description: d.description||null, notes: d.notes||null,
    payment_method: d.paymentMethod||null, check_number: d.checkNumber||null,
    bank_name: d.bankName||null, due_date: dt(d.dueDate),
    booking_id: id(d.bookingId), property_id: id(d.propertyId),
    created_by: d.createdBy||null,
    created_at: dt(d.createdAt), updated_at: dt(d.updatedAt),
  }));

  await migrate('HousekeepingTask', 'housekeeping_tasks', 'housekeepingtasks', d => ({
    id: id(d._id), building: d.building||null, apt: d.apt||null,
    status: d.status||'clean', notes: d.notes||null, updated_by: d.updatedBy||null,
    property_id: id(d.propertyId),
    created_at: dt(d.createdAt), updated_at: dt(d.updatedAt),
  }));

  await migrate('ActivityLog', 'activity_logs', 'activitylogs', d => ({
    id: id(d._id), building: d.building||null, staff_name: d.staffName||null,
    action: d.action||null, apt: d.apt||null, guest_name: d.guestName||null,
    booking_id: id(d.bookingId), details: d.details||null, property_id: id(d.propertyId),
    created_at: dt(d.createdAt), updated_at: dt(d.updatedAt),
  }));

  await migrate('Conversation', 'conversations', 'conversations', d => ({
    id: id(d._id), customer: id(d.customer), customer_name: d.customerName||null,
    subject: d.subject||null, status: d.status||'open',
    unread_admin: d.unreadAdmin||0, unread_customer: d.unreadCustomer||0,
    last_at: dt(d.lastAt),
    created_at: dt(d.createdAt), updated_at: dt(d.updatedAt),
  }));

  await migrate('Message', 'messages', 'messages', d => ({
    id: id(d._id), conversation: id(d.conversation), sender: d.sender||null,
    sender_name: d.senderName||null, body: d.body||'',
    created_at: dt(d.createdAt), updated_at: dt(d.updatedAt),
  }));

  await migrate('Review', 'reviews', 'reviews', d => ({
    id: id(d._id), listing: id(d.listing), booking: id(d.booking),
    customer: id(d.customer), customer_name: d.customerName||null,
    rating: d.rating||null, comment: d.comment||null,
    created_at: dt(d.createdAt), updated_at: dt(d.updatedAt),
  }));

  await migrate('Inquiry', 'inquiries', 'inquiries', d => ({
    id: id(d._id), name: d.name||null, phone: d.phone||null,
    email: d.email||null, message: d.message||null, listing: id(d.listing),
    status: d.status||'new', notes: d.notes||null,
    created_at: dt(d.createdAt), updated_at: dt(d.updatedAt),
  }));

  await migrate('ChannelConfig', 'channel_configs', 'channelconfigs', d => ({
    id: id(d._id), building: d.building||null, property_id: id(d.propertyId),
    platform: d.platform||null, enabled: bool(d.enabled, false),
    ical_import: d.icalImport||null, ical_secret: d.icalSecret||null,
    api_key: d.apiKey||null, api_secret: d.apiSecret||null, hotel_id: d.hotelId||null,
    last_sync: dt(d.lastSync), last_sync_status: d.lastSyncStatus||'never',
    last_sync_msg: d.lastSyncMsg||null, notify_email: d.notifyEmail||null,
    created_at: dt(d.createdAt), updated_at: dt(d.updatedAt),
  }));

  await migrate('ChannelListing', 'channel_listings', 'channellistings', d => ({
    id: id(d._id), building: d.building||null, apt: d.apt||null,
    property_id: id(d.propertyId), platform: d.platform||null,
    enabled: bool(d.enabled, false), platform_listing_id: d.platformListingId||null,
    ical_import: d.icalImport||null, last_sync: dt(d.lastSync),
    last_sync_status: d.lastSyncStatus||'never', last_sync_msg: d.lastSyncMsg||null,
    last_event_count: d.lastEventCount||0,
    created_at: dt(d.createdAt), updated_at: dt(d.updatedAt),
  }));

  await migrate('AuditLog', 'audit_logs', 'auditlogs', d => ({
    id: id(d._id), user: d.user||null, role: d.role||null,
    action: d.action||null, model: d.model||null, record_id: d.recordId||null,
    summary: d.summary||null, changes: jsonb(d.changes)||null, ip: d.ip||null,
    created_at: dt(d.createdAt), updated_at: dt(d.updatedAt),
  }));

  await migrate('RoomInfo', 'room_infos', 'roominfos', d => ({
    id: id(d._id), building: d.building||null, apt: d.apt||null,
    property_id: id(d.propertyId), room_type: d.roomType||null, beds: d.beds||null,
    price_per_night: num(d.pricePerNight)||null, price_per_month: num(d.pricePerMonth)||null,
    created_at: dt(d.createdAt), updated_at: dt(d.updatedAt),
  }));

  await migrate('CommissionHistory', 'commission_history', 'commissionhistories', d => ({
    id: id(d._id), agent_name: d.agentName||null, booking_id: id(d.bookingId),
    amount: num(d.amount)||null, percentage: num(d.percentage)||null, notes: d.notes||null,
    created_at: dt(d.createdAt), updated_at: dt(d.updatedAt),
  }));

  await migrate('Config', 'configs', 'configs', d => ({
    id: id(d._id), key: d.key||null, value: jsonb(d.value),
    created_at: dt(d.createdAt), updated_at: dt(d.updatedAt),
  }));

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log('\n' + '═'.repeat(50));
  console.log(`✅ اكتمل الترحيل في ${elapsed} ثانية`);
  console.log('═'.repeat(50));
  console.log('\n📌 الخطوات التالية:');
  console.log('   1. أضف DATABASE_URL في Vercel Environment Variables');
  console.log('   2. تأكد أن الكود يستخدم db/index.js بدل Mongoose');
  console.log('   3. أعد النشر على Vercel\n');

  await mongoose.disconnect();
  process.exit(0);
})().catch(e => {
  console.error('❌', e.message);
  mongoose.disconnect().catch(() => {});
  process.exit(1);
});
