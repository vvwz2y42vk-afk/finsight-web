const { pgTable, text, integer, numeric, boolean, timestamp, jsonb, unique, index } = require('drizzle-orm/pg-core');

// ─── Admin Users ──────────────────────────────────────────
const adminUsers = pgTable('admin_users', {
  id:        text('id').primaryKey(),
  name:      text('name').notNull(),
  username:  text('username').notNull().unique(),
  password:  text('password').notNull(),
  role:      text('role').default('employee'),
  avatar:    text('avatar'),
  allowed:   jsonb('allowed').default([]),
  active:    boolean('active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ─── Staff Users ──────────────────────────────────────────
const staffUsers = pgTable('staff_users', {
  id:               text('id').primaryKey(),
  name:             text('name').notNull(),
  username:         text('username').notNull().unique(),
  password:         text('password').notNull(),
  building:         text('building'),
  role:             text('role').default('receptionist'),
  active:           boolean('active').default(true),
  permissions:      jsonb('permissions').default([]),
  propertyId:       text('property_id'),
  resetToken:       text('reset_token'),
  resetTokenExpiry: timestamp('reset_token_expiry'),
  createdAt:        timestamp('created_at').defaultNow(),
  updatedAt:        timestamp('updated_at').defaultNow(),
});

// ─── Customers ────────────────────────────────────────────
const customers = pgTable('customers', {
  id:               text('id').primaryKey(),
  name:             text('name').notNull(),
  phone:            text('phone').notNull().unique(),
  password:         text('password').notNull(),
  email:            text('email'),
  nationalId:       text('national_id'),
  nationality:      text('nationality').default('سعودي'),
  notes:            text('notes').default(''),
  resetToken:       text('reset_token'),
  resetTokenExpiry: timestamp('reset_token_expiry'),
  createdAt:        timestamp('created_at').defaultNow(),
  updatedAt:        timestamp('updated_at').defaultNow(),
});

// ─── Hosts ────────────────────────────────────────────────
const hosts = pgTable('hosts', {
  id:          text('id').primaryKey(),
  name:        text('name').notNull(),
  phone:       text('phone').notNull().unique(),
  password:    text('password').notNull(),
  email:       text('email'),
  nationalId:  text('national_id'),
  nationality: text('nationality'),
  status:      text('status').default('pending'),
  createdAt:   timestamp('created_at').defaultNow(),
  updatedAt:   timestamp('updated_at').defaultNow(),
});

// ─── Properties (SaaS tenants) ────────────────────────────
const properties = pgTable('properties', {
  id:         text('id').primaryKey(),
  name:       text('name').notNull(),
  type:       text('type'),
  city:       text('city'),
  phone:      text('phone'),
  adminEmail: text('admin_email'),
  buildings:  jsonb('buildings').default([]),
  plan:       text('plan').default('trial'),
  planExpiry: timestamp('plan_expiry'),
  active:     boolean('active').default(true),
  createdAt:  timestamp('created_at').defaultNow(),
  updatedAt:  timestamp('updated_at').defaultNow(),
});

// ─── Bookings ─────────────────────────────────────────────
const bookings = pgTable('bookings', {
  id:            text('id').primaryKey(),
  name:          text('name'),
  phone:         text('phone'),
  email:         text('email'),
  building:      text('building'),
  apt:           text('apt'),
  listingTitle:  text('listing_title'),
  listing:       text('listing'),
  bookingType:   text('booking_type').default('daily'),
  status:        text('status').default('pending'),
  checkIn:       timestamp('check_in'),
  checkOut:      timestamp('check_out'),
  nights:        integer('nights').default(0),
  guests:        integer('guests').default(1),
  totalPrice:    numeric('total_price', { precision: 12, scale: 2 }).default('0'),
  paidAmount:    numeric('paid_amount',  { precision: 12, scale: 2 }).default('0'),
  payments:      jsonb('payments').default([]),
  paymentMethod: text('payment_method').default(''),
  idType:        text('id_type').default(''),
  idNumber:      text('id_number'),
  companions:    jsonb('companions').default([]),
  source:        text('source'),
  propertyId:    text('property_id'),
  pricePerNight: numeric('price_per_night', { precision: 10, scale: 2 }),
  pricePerMonth: numeric('price_per_month', { precision: 10, scale: 2 }),
  notes:         text('notes'),
  createdBy:     text('created_by'),
  createdAt:     timestamp('created_at').defaultNow(),
  updatedAt:     timestamp('updated_at').defaultNow(),
}, t => ({
  idxBuilding:    index('bk_building_idx').on(t.building),
  idxStatus:      index('bk_status_idx').on(t.status),
  idxCheckIn:     index('bk_check_in_idx').on(t.checkIn),
  idxPropertyId:  index('bk_property_id_idx').on(t.propertyId),
  idxAptBuilding: index('bk_apt_building_idx').on(t.apt, t.building),
}));

// ─── Contracts (legacy) ───────────────────────────────────
const contracts = pgTable('contracts', {
  id:        text('id').primaryKey(),
  mongoId:   text('mongo_id'),
  n:         text('n'),
  sheet:     text('sheet'),
  a:         text('a'),
  v:         numeric('v', { precision: 12, scale: 2 }),
  p:         numeric('p', { precision: 12, scale: 2 }),
  r:         numeric('r', { precision: 12, scale: 2 }),
  en:        timestamp('en'),
  ex:        timestamp('ex'),
  ph:        text('ph'),
  st:        text('st'),
  py:        text('py'),
  src:       text('src'),
  type:      text('type'),
  notes:     text('notes'),
  ej:        text('ej'),
  pm:        text('pm'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, t => ({
  idxSt:      index('ct_st_idx').on(t.st),
  idxEx:      index('ct_ex_idx').on(t.ex),
  idxSheetSt: index('ct_sheet_st_idx').on(t.sheet, t.st),
}));

// ─── Listings ─────────────────────────────────────────────
const listings = pgTable('listings', {
  id:           text('id').primaryKey(),
  category:     text('category'),
  building:     text('building'),
  apt:          text('apt'),
  floor:        text('floor'),
  location:     text('location'),
  title:        text('title'),
  description:  text('description'),
  type:         text('type').default('daily'),
  priceDaily:   numeric('price_daily',   { precision: 10, scale: 2 }),
  priceAnnual:  numeric('price_annual',  { precision: 10, scale: 2 }),
  priceSale:    numeric('price_sale',    { precision: 10, scale: 2 }),
  bedrooms:     integer('bedrooms'),
  bathrooms:    integer('bathrooms'),
  area:         numeric('area', { precision: 10, scale: 2 }),
  maxGuests:    integer('max_guests'),
  amenities:    jsonb('amenities').default([]),
  photos:       jsonb('photos').default([]),
  available:    boolean('available').default(true),
  featured:     boolean('featured').default(false),
  blockedRanges:jsonb('blocked_ranges').default([]),
  host:         text('host'),
  createdAt:    timestamp('created_at').defaultNow(),
  updatedAt:    timestamp('updated_at').defaultNow(),
}, t => ({
  idxCatAvail: index('ls_cat_avail_idx').on(t.category, t.available),
  idxHost:     index('ls_host_idx').on(t.host),
}));

// ─── Guests (دفتر الضيوف) ─────────────────────────────────
const guests = pgTable('guests', {
  id:            text('id').primaryKey(),
  name:          text('name'),
  phone:         text('phone'),
  idType:        text('id_type'),
  idNumber:      text('id_number'),
  nationality:   text('nationality'),
  email:         text('email'),
  building:      text('building'),
  category:      text('category').default('regular'),
  totalBookings: integer('total_bookings').default(0),
  lastSeen:      timestamp('last_seen'),
  propertyId:    text('property_id'),
  notes:         text('notes'),
  createdAt:     timestamp('created_at').defaultNow(),
  updatedAt:     timestamp('updated_at').defaultNow(),
}, t => ({
  uniqPhoneProp: unique('gs_phone_prop_uniq').on(t.phone, t.propertyId),
  idxPropertyId: index('gs_property_id_idx').on(t.propertyId),
}));

// ─── Vouchers (السندات) ───────────────────────────────────
const vouchers = pgTable('vouchers', {
  id:            text('id').primaryKey(),
  building:      text('building'),
  type:          text('type'),
  number:        text('number'),
  date:          timestamp('date'),
  name:          text('name'),
  phone:         text('phone'),
  apt:           text('apt'),
  amount:        numeric('amount', { precision: 12, scale: 2 }).default('0'),
  description:   text('description'),
  notes:         text('notes'),
  paymentMethod: text('payment_method'),
  checkNumber:   text('check_number'),
  bankName:      text('bank_name'),
  dueDate:       timestamp('due_date'),
  bookingId:     text('booking_id'),
  propertyId:    text('property_id'),
  createdBy:     text('created_by'),
  createdAt:     timestamp('created_at').defaultNow(),
  updatedAt:     timestamp('updated_at').defaultNow(),
}, t => ({
  idxBuilding:   index('vc_building_idx').on(t.building),
  idxPropertyId: index('vc_property_id_idx').on(t.propertyId),
  idxBookingId:  index('vc_booking_id_idx').on(t.bookingId),
}));

// ─── Housekeeping Tasks ───────────────────────────────────
const housekeepingTasks = pgTable('housekeeping_tasks', {
  id:         text('id').primaryKey(),
  building:   text('building'),
  apt:        text('apt'),
  status:     text('status').default('clean'),
  notes:      text('notes'),
  updatedBy:  text('updated_by'),
  propertyId: text('property_id'),
  createdAt:  timestamp('created_at').defaultNow(),
  updatedAt:  timestamp('updated_at').defaultNow(),
}, t => ({
  uniqBldgAptProp: unique('hk_bldg_apt_prop_uniq').on(t.building, t.apt, t.propertyId),
}));

// ─── Activity Logs ────────────────────────────────────────
const activityLogs = pgTable('activity_logs', {
  id:         text('id').primaryKey(),
  building:   text('building'),
  staffName:  text('staff_name'),
  action:     text('action'),
  apt:        text('apt'),
  guestName:  text('guest_name'),
  bookingId:  text('booking_id'),
  details:    text('details'),
  propertyId: text('property_id'),
  createdAt:  timestamp('created_at').defaultNow(),
  updatedAt:  timestamp('updated_at').defaultNow(),
}, t => ({
  idxBuilding:  index('al_building_idx').on(t.building),
  idxCreatedAt: index('al_created_at_idx').on(t.createdAt),
}));

// ─── Conversations ────────────────────────────────────────
const conversations = pgTable('conversations', {
  id:             text('id').primaryKey(),
  customer:       text('customer'),
  customerName:   text('customer_name'),
  subject:        text('subject'),
  status:         text('status').default('open'),
  unreadAdmin:    integer('unread_admin').default(0),
  unreadCustomer: integer('unread_customer').default(0),
  lastAt:         timestamp('last_at').defaultNow(),
  createdAt:      timestamp('created_at').defaultNow(),
  updatedAt:      timestamp('updated_at').defaultNow(),
}, t => ({
  idxCustomer: index('cv_customer_idx').on(t.customer),
  idxStatus:   index('cv_status_idx').on(t.status),
}));

// ─── Messages ─────────────────────────────────────────────
const messages = pgTable('messages', {
  id:           text('id').primaryKey(),
  conversation: text('conversation'),
  sender:       text('sender'),
  senderName:   text('sender_name'),
  body:         text('body').notNull(),
  createdAt:    timestamp('created_at').defaultNow(),
  updatedAt:    timestamp('updated_at').defaultNow(),
}, t => ({
  idxConv: index('mg_conv_idx').on(t.conversation, t.createdAt),
}));

// ─── Reviews ──────────────────────────────────────────────
const reviews = pgTable('reviews', {
  id:           text('id').primaryKey(),
  listing:      text('listing'),
  booking:      text('booking').unique(),
  customer:     text('customer'),
  customerName: text('customer_name'),
  rating:       integer('rating'),
  comment:      text('comment'),
  createdAt:    timestamp('created_at').defaultNow(),
  updatedAt:    timestamp('updated_at').defaultNow(),
}, t => ({
  idxListing:  index('rv_listing_idx').on(t.listing),
  idxCustomer: index('rv_customer_idx').on(t.customer),
}));

// ─── Inquiries ────────────────────────────────────────────
const inquiries = pgTable('inquiries', {
  id:        text('id').primaryKey(),
  name:      text('name'),
  phone:     text('phone'),
  email:     text('email'),
  message:   text('message'),
  listing:   text('listing'),
  status:    text('status').default('new'),
  notes:     text('notes'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ─── Channel Configs ──────────────────────────────────────
const channelConfigs = pgTable('channel_configs', {
  id:             text('id').primaryKey(),
  building:       text('building'),
  propertyId:     text('property_id'),
  platform:       text('platform'),
  enabled:        boolean('enabled').default(false),
  icalImport:     text('ical_import'),
  icalSecret:     text('ical_secret'),
  apiKey:         text('api_key'),
  apiSecret:      text('api_secret'),
  hotelId:        text('hotel_id'),
  lastSync:       timestamp('last_sync'),
  lastSyncStatus: text('last_sync_status').default('never'),
  lastSyncMsg:    text('last_sync_msg'),
  notifyEmail:    text('notify_email'),
  createdAt:      timestamp('created_at').defaultNow(),
  updatedAt:      timestamp('updated_at').defaultNow(),
}, t => ({
  uniqBldgPlatform: unique('cc_bldg_platform_uniq').on(t.building, t.platform),
}));

// ─── Channel Listings ─────────────────────────────────────
const channelListings = pgTable('channel_listings', {
  id:                text('id').primaryKey(),
  building:          text('building'),
  apt:               text('apt'),
  propertyId:        text('property_id'),
  platform:          text('platform'),
  enabled:           boolean('enabled').default(false),
  platformListingId: text('platform_listing_id'),
  icalImport:        text('ical_import'),
  lastSync:          timestamp('last_sync'),
  lastSyncStatus:    text('last_sync_status').default('never'),
  lastSyncMsg:       text('last_sync_msg'),
  lastEventCount:    integer('last_event_count').default(0),
  createdAt:         timestamp('created_at').defaultNow(),
  updatedAt:         timestamp('updated_at').defaultNow(),
}, t => ({
  uniqBldgAptPlatform: unique('cl_bldg_apt_platform_uniq').on(t.building, t.apt, t.platform),
}));

// ─── Audit Logs ───────────────────────────────────────────
const auditLogs = pgTable('audit_logs', {
  id:        text('id').primaryKey(),
  user:      text('user'),
  role:      text('role'),
  action:    text('action'),
  model:     text('model'),
  recordId:  text('record_id'),
  summary:   text('summary'),
  changes:   jsonb('changes'),
  ip:        text('ip'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ─── Room Info ────────────────────────────────────────────
const roomInfos = pgTable('room_infos', {
  id:            text('id').primaryKey(),
  building:      text('building'),
  apt:           text('apt'),
  propertyId:    text('property_id'),
  roomType:      text('room_type'),
  beds:          text('beds'),
  pricePerNight: numeric('price_per_night', { precision: 10, scale: 2 }),
  pricePerMonth: numeric('price_per_month', { precision: 10, scale: 2 }),
  createdAt:     timestamp('created_at').defaultNow(),
  updatedAt:     timestamp('updated_at').defaultNow(),
}, t => ({
  uniqBldgAptProp: unique('ri_bldg_apt_prop_uniq').on(t.building, t.apt, t.propertyId),
}));

// ─── Commission History ───────────────────────────────────
const commissionHistory = pgTable('commission_history', {
  id:         text('id').primaryKey(),
  agentName:  text('agent_name'),
  bookingId:  text('booking_id'),
  amount:     numeric('amount', { precision: 12, scale: 2 }),
  percentage: numeric('percentage', { precision: 5, scale: 2 }),
  notes:      text('notes'),
  createdAt:  timestamp('created_at').defaultNow(),
  updatedAt:  timestamp('updated_at').defaultNow(),
});

// ─── Config ───────────────────────────────────────────────
const configs = pgTable('configs', {
  id:        text('id').primaryKey(),
  key:       text('key').unique(),
  value:     jsonb('value'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

module.exports = {
  adminUsers, staffUsers, customers, hosts, properties,
  bookings, contracts, listings, guests, vouchers,
  housekeepingTasks, activityLogs, conversations, messages,
  reviews, inquiries, channelConfigs, channelListings,
  auditLogs, roomInfos, commissionHistory, configs,
};
