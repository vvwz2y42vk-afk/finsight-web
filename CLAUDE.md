# BAREZ — دليل المشروع الشامل

## نظرة عامة

**BAREZ** منصة إدارة شقق مفروشة مبنية على:
- **Backend**: Node.js + Express.js
- **Database**: MongoDB + Mongoose
- **Views**: EJS templates
- **Auth**: JWT في cookies (لا sessions)
- **Deploy**: Vercel (serverless) — كل request قد يكون instance مستقل
- **Email**: Resend API (متغير `RESEND_API_KEY`)
- **Entry point**: `server.js` → يشغّل على port 3000

---

## هيكل المجلدات

```
finsight-web/
├── server.js              # نقطة الدخول، middleware، MongoDB connect، auth للأدمن
├── routes/
│   ├── api.js             # /api/* — الـ API للأدمن ومنطق العمل
│   ├── staff.js           # /staff/* — كل شيء للموظفين (صفحات + API)
│   ├── client.js          # / — الموقع العام (صفحة رئيسية، شقق، listings)
│   ├── account.js         # /account/* — تسجيل/دخول العملاء
│   └── host.js            # /host/* — تسجيل/دخول/لوحة المضيفين
├── models/                # كل نماذج MongoDB
├── views/
│   ├── dashboard.html     # لوحة التحكم الإدارية (static HTML، ~2950 سطر)
│   ├── staff-dashboard.ejs# لوحة الموظفين
│   ├── channel-manager.ejs# إدارة القنوات (Airbnb، Booking، إلخ)
│   ├── staff-superadmin.ejs# صفحة إدارة المستأجرين
│   └── ... (باقي الـ views)
├── middleware/
│   ├── security.js        # securityHeaders، sanitizeBody، noSQLGuard
│   └── securityLog.js     # logSecEvent، securityAuditInterceptor
└── utils/
    ├── auth.js            # createToken، verifyToken، requireRole
    ├── rateLimit.js       # createRateLimiter
    ├── mailer.js          # sendEmail عبر Resend
    └── whatsapp.js        # WA.sendCheckIn، sendCheckOut، sendBookingConfirmed
```

---

## المصادقة والصلاحيات

### أنواع المستخدمين وأدواتهم

| النوع | Cookie | مدة | نموذج DB |
|-------|--------|-----|----------|
| أدمن | `fs_auth` | 24h | `AdminUser` |
| موظف | `fs_staff` | 12h | `StaffUser` |
| عميل | `fs_cust` | 30 يوم | `Customer` |
| مضيف | `fs_host` | 30 يوم | `Host` |

### الأدمن (`/dashboard` + `/api/*`)
- تسجيل دخول من `POST /login` → يبحث في DB أولاً (bcrypt)، ثم env vars كـ fallback
- JWT يحمل: `{ username, name, role, avatar, allowed[] }`
- `role`: `'admin' | 'manager' | 'employee'`
- `allowed[]`: قائمة الأقسام المسموح بها

### الموظف (`/staff/*`)
- تسجيل دخول من `POST /staff/login`
- JWT يحمل: `{ id, name, building, role, permissions[], propertyId, planExpiry }`
- **مهم**: الصلاحيات تُحدَّث من DB عند كل تحميل للـ dashboard (حل مشكلة الـ stale JWT)
- `role`: `'receptionist' | 'manager'`
- `DEFAULT_PERMS`: `['dashboard','apartments','bookings','customers','housekeeping','activity','new_booking','edit_booking','cancel_booking','vouchers','reports','guests']`
- فلتر الموظف للحجوزات: إذا `propertyId` → `{ propertyId }` وإلا → `{ building, propertyId: null }`

### Multi-tenancy (SaaS)
- الحجوزات الداخلية لـ BAREZ: `{ propertyId: null }`
- حجوزات المستأجرين الخارجيين: `{ propertyId: ObjectId }`
- نموذج `Property` يحمل خطة الاشتراك (`plan`, `planExpiry`, `active`)
- Super Admin: role = `'admin'` في `fs_auth` → وصول إلى `/staff/superadmin`

---

## قاعدة البيانات — النماذج

### `Booking` (المصدر الرئيسي للحجوزات)
```
name, phone, email
building, apt            ← حقلان مهمان للفلترة
listingTitle, listing    ← ObjectId → Listing (null للحجوزات اليدوية)
bookingType: 'daily'|'annual'|'inquiry'
status: 'pending'|'awaiting_payment'|'awaiting_checkin'|'active'|'checkout'|'cancelled'
checkIn, checkOut        ← Date (ISO)
nights, guests
totalPrice, paidAmount
payments[]               ← سجل الدفعات (amount, paymentMethod, isDeposit, voucherId)
paymentMethod: 'cash'|'transfer'|'network'|'check'|'digital'|'travel_agent'|'other'|''
idType: 'national_id'|'passport'|'iqama'|'family_card'|''
idNumber, companions[]
source                   ← نزيل|يدوي|استقبال مباشر|جاذرين|Booking.com|Airbnb|Agoda|manual|ch-*
propertyId               ← null للداخلي، ObjectId للـ SaaS
pricePerNight, pricePerMonth
```
**فلتر حجوزات الموظف في الداشبورد الإداري:**
```js
{ building: { $exists: true, $ne: null }, listing: null, status: { $ne: 'cancelled' } }
```

**انتقالات الحالة المسموحة:**
```
pending → active|awaiting_payment|awaiting_checkin|cancelled
awaiting_payment → pending|awaiting_checkin|cancelled
awaiting_checkin → active|cancelled
active → checkout
checkout → (نهاية)
cancelled → (نهاية)
```

### `Contract` (نموذج قديم — legacy)
حقوله مختصرة: `id, n(name), sheet(building), a(apt), v(value), p(paid), r(remaining), en(checkIn), ex(checkOut), ph(phone), st(status), py(paymentStatus), src(source), type, notes, ej(ejar), pm(paymentMethod)`

**ملاحظة**: الداشبورد الإداري يعتمد على `Booking` الآن، ليس `Contract`. `Contract` موجود لكنه فارغ في الإنتاج.

### `StaffUser`
```
name, username (unique), password (bcrypt)
building, role: 'receptionist'|'manager'
active: Boolean
permissions: String[]
propertyId: ObjectId|null
resetToken, resetTokenExpiry
```

### `AdminUser`
```
name, username, password (bcrypt)
role: 'admin'|'manager'|'employee'
avatar, allowed: String[], active
```

### `Customer`
```
name, phone (unique), password (bcrypt)
email, nationalId, nationality
notes, resetToken, resetTokenExpiry
```

### `Listing`
```
category: 'rental_apartment'|'rental_commercial'|'sale_land'|'sale_apartment'
building, apt, floor, location, title, description
type: 'daily'|'annual'|'both'
price_daily, price_annual, price_sale
bedrooms, bathrooms, area, maxGuests
amenities[], photos[], available, featured
blockedRanges[]: { checkIn, checkOut, bookingId }
host: ObjectId|null   ← null = عقار BAREZ الخاص
```

### `Voucher`
```
building, type: 'receipt'|'invoice'|'disbursement'|'check'|'tax'
number (QBD-0001، INV-0001، إلخ), date, name, phone, apt
amount, description, notes, paymentMethod
bookingId, propertyId
createdBy (staffName)
```

### `HousekeepingTask`
```
building, apt, status: 'clean'|'dirty'|'inspecting'|'maintenance'
notes, updatedBy, propertyId
```
**فريدة**: `{ building, apt, propertyId }` — واحدة لكل شقة.

### `ActivityLog`
```
building, staffName
action: 'check_in'|'check_out'|'status_change'|'housekeeping'|'booking_add'
apt, guestName, bookingId, details, propertyId
```

### `ChannelConfig`
```
building, propertyId
platform: 'airbnb'|'booking'|'gathering'|'website'
enabled, icalImport (URL للجلب), icalSecret (للتصدير)
apiKey, apiSecret, hotelId
lastSync, lastSyncStatus: 'ok'|'error'|'never', lastSyncMsg
notifyEmail
```
**فريدة**: `{ building, platform }`

### `ChannelListing`
```
building, apt, propertyId
platform: 'airbnb'|'booking'|'gathering'
enabled, platformListingId, icalImport
lastSync, lastSyncStatus, lastSyncMsg, lastEventCount
```
**فريدة**: `{ building, apt, platform }`

### `Conversation` + `Message`
رسائل بين العملاء والأدمن. `Conversation.status`: `'open'|'closed'`.

### `Property` (للـ SaaS)
```
name, type, city, phone, adminEmail
buildings[]: { name, floors[]: { label, rooms[] } }
plan: 'trial'|'basic'|'pro'
planExpiry: Date, active: Boolean
```

### `Guest` (دفتر الضيوف للموظفين)
ملف كل ضيف مع: `name, phone, idType, idNumber, category: 'regular'|'vip'|'blocked'`, `totalBookings`, بيانات العنوان، `propertyId`.

### `Review`
```
listing, booking (unique), customer
customerName, rating (1-5), comment
```

### `AuditLog`
سجل أمني: `user, role, action, model, recordId, summary, changes, ip`

---

## المباني والشقق (BAREZ الداخلي)

```js
// المنارا
أرضي: [001, 002]
الأول: [101-106]
الثاني: [201-206]
الثالث: [301-306]
الرابع: [401-406]
الخامس: [501-504]
// المجموع: 30 شقة

// جوان ان (لا توجد 306!)
أرضي: [001-004]
الأول: [101-105]
الثاني: [201-205]
الثالث: [301-305]   ← 5 فقط (بدون 306)
الرابع: [401-402]
// المجموع: 21 شقة

// الماسة
الأول: [101-106]
الثاني: [201-206]
الثالث: [301-306]
// المجموع: 18 شقة

// الواحة
أرضي: [001-004]
الأول: [101-108]
الثاني: [201-208]
// المجموع: 20 شقة
```

**إجمالي**: 89 شقة

تعريف المباني موجود في **3 أماكن** — تأكد من التعديل في الثلاثة:
1. `routes/staff.js` → `const BLDGS`
2. `routes/api.js` → `const GRID_BUILDINGS` و `BUILDINGS`
3. `views/dashboard.html` → `const BUILDINGS` و `const GRID_BUILDINGS`

---

## الـ API Endpoints

### لوحة التحكم الإدارية (`/api/*`)
يتطلب: `fs_auth` cookie صالح

| Method | Path | الوظيفة |
|--------|------|---------|
| GET | `/api/contracts` | جلب العقود (Contract model، paginated) |
| POST | `/api/contracts` | إنشاء/تحديث عقد |
| PUT | `/api/contracts/:id` | تعديل عقد |
| DELETE | `/api/contracts/:id` | حذف عقد (admin فقط) |
| POST | `/api/contracts/bulk` | استيراد جماعي (admin فقط) |
| GET | `/api/booking-stats` | إحصائيات الحجوزات اليدوية (facet aggregation واحد) |
| GET | `/api/staff-bookings-full` | كل الحجوزات اليدوية بدون حد (للداشبورد) |
| POST | `/api/bookings` | إنشاء حجز جديد من الداشبورد الإداري |
| GET | `/api/bookings` | جلب الحجوزات (مع فلتر status/listing) |
| PUT | `/api/bookings/:id` | تعديل حجز |
| DELETE | `/api/bookings/:id` | حذف حجز (admin/manager) |
| GET | `/api/apartments/available` | الشقق الفارغة (من Contract model) |
| GET | `/api/apartments/grid` | خريطة الشقق مع حالة كل شقة |
| GET | `/api/weekly-stats` | الإشغال الأسبوعي (مجمع + `perBuilding`) |
| GET | `/api/housekeeping-stats` | إحصائيات التنظيف |
| GET | `/api/staff-performance` | أداء الموظفين (آخر 30 يوم) |
| GET | `/api/activity` | سجل الأحداث (آخر 60) |
| GET | `/api/customers` | قائمة العملاء (paginated، بحث) |
| POST | `/api/inquiries` | إرسال استفسار (عام) |
| GET | `/api/inquiries` | جلب الاستفسارات |
| PUT | `/api/inquiries/:id` | تحديث استفسار |
| GET | `/api/listings` | جلب الـ listings |
| POST | `/api/listings` | إنشاء listing |
| PUT | `/api/listings/:id` | تعديل listing |
| DELETE | `/api/listings/:id` | حذف listing |
| GET | `/api/conversations` | جلب المحادثات |
| GET | `/api/conversations/:id` | جلب محادثة مع رسائلها |
| POST | `/api/conversations/:id/reply` | رد الأدمن |
| POST | `/api/conversations/:id/close` | إغلاق المحادثة |
| POST | `/api/ai/chat` | دردشة Gemini AI |
| GET | `/api/hosts` | قائمة المضيفين |
| PUT | `/api/hosts/:id/approve` | قبول مضيف |
| PUT | `/api/hosts/:id/reject` | رفض مضيف |
| PUT | `/api/hosts/:id/suspend` | تعليق مضيف |
| GET | `/api/admin-users` | إدارة الأدمن (admin فقط) |
| POST | `/api/admin-users` | إنشاء أدمن جديد |
| PUT | `/api/admin-users/:id` | تعديل أدمن |
| DELETE | `/api/admin-users/:id` | حذف أدمن |
| GET | `/api/commission-history` | سجل العمولات |
| POST | `/api/commission-history` | حفظ عمولة |
| GET | `/api/app/listings` | API الجوال — listings |
| GET | `/api/app/listings/:id` | API الجوال — listing واحد |
| POST | `/api/app/inquiry` | API الجوال — استفسار |
| GET | `/api/app/config` | API الجوال — إعدادات التطبيق |

### لوحة الموظفين (`/staff/*`)
يتطلب: `fs_staff` cookie

**صفحات:**

| Path | الوظيفة |
|------|---------|
| GET `/staff/login` | صفحة الدخول |
| POST `/staff/login` | تسجيل الدخول |
| GET `/staff/logout` | تسجيل الخروج |
| GET `/staff/dashboard` | لوحة الموظف (يحدّث permissions من DB) |
| GET `/staff/channels` | إدارة القنوات |
| GET `/staff/register` | تسجيل منشأة جديدة (SaaS) |
| GET `/staff/setup` | إعداد المبنى للمستأجرين الجدد |
| GET/POST `/staff/forgot-password` | نسيت كلمة المرور |
| GET/POST `/staff/reset-password/:token` | إعادة تعيين كلمة المرور |
| GET `/staff/superadmin` | إدارة المستأجرين (admin فقط) |

**API الموظفين (`/staff/api/*`):**

| Method | Path | الوظيفة |
|--------|------|---------|
| GET | `/staff/api/stats` | إحصائيات اليوم (وصول، مغادرة، شاغل، إشغال) |
| GET | `/staff/api/apartments` | حالة الشقق مع الحجوزات والتنظيف |
| GET | `/staff/api/bookings` | قائمة الحجوزات (فلاتر: sf, apt, date, source, q) |
| GET | `/staff/api/bookings/:id` | حجز واحد |
| POST | `/staff/api/bookings/new` | حجز يدوي جديد (مع منع التعارض) |
| PUT | `/staff/api/bookings/:id/status` | تغيير حالة الحجز |
| PUT | `/staff/api/bookings/:id/edit` | تعديل بيانات الحجز |
| POST | `/staff/api/bookings/:id/payments` | إضافة دفعة (يُنشئ Voucher تلقائياً) |
| DELETE | `/staff/api/bookings/:id/payments/:pid` | حذف دفعة |
| GET | `/staff/api/customers` | قائمة الضيوف (Guest model) |
| GET | `/staff/api/guests/:id` | بروفايل ضيف مع تاريخ حجوزاته |
| PUT | `/staff/api/guests/:id` | تعديل بيانات ضيف |
| PUT | `/staff/api/guests/:id/category` | تصنيف (regular/vip/blocked) |
| GET | `/staff/api/housekeeping` | حالة التنظيف لجميع الشقق |
| PUT | `/staff/api/housekeeping/:apt` | تحديث حالة تنظيف شقة |
| GET | `/staff/api/room-info` | معلومات الغرف (نوع، سعر) |
| PUT | `/staff/api/room-info/:apt` | تعديل معلومات غرفة |
| GET | `/staff/api/activity` | سجل الأحداث (آخر 100) |
| GET | `/staff/api/vouchers` | قائمة السندات |
| POST | `/staff/api/vouchers` | إنشاء سند جديد |
| DELETE | `/staff/api/vouchers/:id` | حذف سند |
| GET | `/staff/api/reports` | تقارير مالية شهرية |
| GET | `/staff/api/check-username` | التحقق من توفر اسم المستخدم |
| POST | `/staff/api/setup-building` | إعداد المبنى (SaaS onboarding) |
| POST | `/staff/api/admin/migrate-tenant` | ترحيل البيانات إلى tenant |
| POST | `/staff/api/admin/create` | إنشاء موظف جديد (fs_auth admin) |
| GET | `/staff/api/admin/staff` | قائمة الموظفين (fs_auth admin) |
| PUT | `/staff/api/admin/update` | تعديل بيانات موظف (fs_auth admin) |
| GET | `/staff/api/superadmin/tenants` | قائمة المستأجرين |
| PUT | `/staff/api/superadmin/tenants/:id` | تعديل مستأجر (plan, active, planExpiry) |

**API Channel Manager:**

| Method | Path | الوظيفة |
|--------|------|---------|
| GET | `/staff/api/channels` | إعدادات القنوات للمبنى |
| POST | `/staff/api/channels/:platform` | حفظ إعدادات قناة |
| POST | `/staff/api/channels/:platform/sync` | مزامنة iCal يدوياً |
| GET | `/staff/api/channels/feed` | آخر الحجوزات من القنوات |
| POST | `/staff/api/channels/webhook/:platform` | webhook للحجوزات الواردة |
| GET | `/staff/ical/:building/:secret` | تصدير التقويم (iCal) لمنصة خارجية |
| GET | `/staff/api/listings` | قائمة ChannelListings (شقق+منصات) |
| POST | `/staff/api/listings` | إضافة/تعديل ChannelListing |
| POST | `/staff/api/listings/bulk` | استيراد جماعي للـ ChannelListings |
| POST | `/staff/api/listings/sync-all` | مزامنة كل القنوات |

### الموقع العام

| Path | الوظيفة |
|------|---------|
| GET `/` | الصفحة الرئيسية |
| GET `/apartments` | عرض الشقق الفارغة |
| GET `/listings` | سوق العقارات |
| GET `/about`, `/terms`, `/privacy` | صفحات ثابتة |
| GET `/account/login` | دخول العميل |
| POST `/account/register` | تسجيل عميل جديد |
| GET `/account` | حساب العميل |
| GET `/host/login`, `/host/register` | المضيفون |
| GET `/host/dashboard` | لوحة المضيف |

---

## الداشبورد الإداري (views/dashboard.html)

ملف **static HTML** يُخدَّم من `GET /dashboard` بدون EJS.

### المتغيرات العالمية الرئيسية في JavaScript:
```js
allStaffBookings  // ← المصدر الرئيسي (من /api/staff-bookings-full)
window._bkStats   // ← إحصائيات مجمعة (من /api/booking-stats)
allC              // ← بيانات Contract القديمة (legacy، شبه فارغة)
BUILDINGS         // ← تعريف المباني للخريطة
GRID_BUILDINGS    // ← تعريف المباني مع الطوابق
```

### التبويبات:
- **الرئيسية**: KPIs (إجمالي، محصل، متبقي، مفتوح، مغلق) + خريطة الشقق + مخطط أسبوعي
- **التحصيل**: تفاصيل المدفوعات والمتبقيات
- **المنتهية**: الحجوزات المنتهية أو القريبة من الانتهاء
- **الأداء**: أداء الموظفين (من `/api/staff-performance`)
- **المصادر**: توزيع مصادر الحجوزات
- **التقارير**: تصدير CSV

### دوال مهمة:
```js
normSource(s)     // تطبيع اسم المصدر: 'nazeel-*' → 'نزيل'، 'manual' → 'يدوي'، إلخ
daysToISO(d)      // عدد الأيام حتى تاريخ معين
fmtDate(d)        // تنسيق التاريخ بالعربية
toggleDD(id)      // قائمة منسدلة بـ position:fixed (يتجاوز overflow:hidden)
renderPager(...)  // pagination بنافذة ±2 صفحة
switchWeeklyTab(tab) // تبديل تبويبات الإشغال الأسبوعي
exportReportCSV() // تصدير CSV
```

### Pagination:
- العقود: 20 لكل صفحة
- حجوزات الموظفين: 30 لكل صفحة

---

## لوحة الموظفين (views/staff-dashboard.ejs)

تُرسَل المتغيرات من `routes/staff.js`:
```js
res.render('staff-dashboard', { staff: req.staff })
```

### `req.staff` يحمل:
```js
{ id, name, building, role, permissions[], propertyId, planExpiry }
```

### التبويبات (مرتبطة بـ permissions):
- `dashboard` — الرئيسية (إحصائيات اليوم + إشغال أسبوعي)
- `apartments` — خريطة الشقق
- `bookings` — إدارة الحجوزات
- `customers` — قائمة الضيوف
- `housekeeping` — التنظيف
- `activity` — سجل الأحداث
- `vouchers` — السندات المالية
- `reports` — التقارير

### صلاحيات الأفعال:
- `new_booking` — إنشاء حجز جديد
- `edit_booking` — تعديل حجز
- `cancel_booking` — إلغاء حجز
- `edit_room_info` — تعديل معلومات الغرف
- `guests` — الوصول إلى دفتر الضيوف

---

## ملاحظات مهمة للتطوير

### 1. بيئة Vercel (serverless)
- كل request قد يكون في instance مختلف — لا تعتمد على حالة في الذاكرة
- MongoDB connection يتم في كل request عبر `connectDB()` مع retry
- الاتصال: `maxPoolSize: 10`، `serverSelectionTimeoutMS: 15000`

### 2. جوان ان — لا توجد شقة 306
هذا مقصود. 306 غير موجودة في المبنى. تأكد من عدم إضافتها عند تعديل أي ملف.

### 3. مصادر الحجوزات (source field)
القيم المعيارية في قاعدة البيانات:
`نزيل | يدوي | استقبال مباشر | جاذرين | Booking.com | Airbnb | Agoda | ch-airbnb | ch-booking | ch-gathering`

دالة `normSource()` في `dashboard.html` تطبّع القيم القديمة.

### 4. الداشبورد يعتمد على Booking وليس Contract
- `allC` (Contract) شبه فارغ في الإنتاج
- `allStaffBookings` (Booking) = 11,000+ حجز
- فلتر الحجوزات اليدوية: `{ building: { $exists: true, $ne: null }, listing: null, status: { $ne: 'cancelled' } }`

### 5. الـ dropdown في جداول الموظفين
كانت مشكلة `overflow:hidden` تقطع القوائم. الحل: `.dd-menu` يستخدم `position:fixed` مع `getBoundingClientRect()`.

### 6. تحديث الصلاحيات
الصلاحيات مخزنة في JWT → إذا غيّرتها من الإدارة، لن تُطبَّق حتى تسجيل الخروج ودخول جديد. **الحل المُطبَّق**: `GET /staff/dashboard` يجلب الصلاحيات من DB ويجدد الـ cookie.

### 7. مزامنة iCal
- مسار التصدير: `GET /staff/ical/:building/:secret`
- المزامنة اليدوية: `POST /staff/api/channels/:platform/sync`
- عند اكتشاف حجز جديد من قناة → يُرسَل إيميل تنبيه
- الـ source يبدأ بـ `ch-` للحجوزات القادمة من القنوات

### 8. الـ weekly stats
`GET /api/weekly-stats` يُعيد:
```json
{ "weekly": [...], "total": 89, "perBuilding": { "المنارا": {...}, ... } }
```
الداشبورد يعرض tabs للتبديل بين المجمع وكل مبنى.

### 9. إنشاء السندات تلقائياً
عند إضافة دفعة جديدة (`POST /staff/api/bookings/:id/payments`):
- يُنشئ Voucher من نوع `receipt` برقم `QBD-XXXX`
- يضيف الدفعة لـ `payments[]` في الحجز
- يحسب `paidAmount` مجدداً من مجموع `payments[]`

### 10. تعارض الحجوزات (Double-booking)
`POST /staff/api/bookings/new` يتحقق:
```js
{ apt, building, status: { $in: ['awaiting_checkin','active'] },
  checkIn: { $lt: checkout }, checkOut: { $gt: checkIn } }
```
وإذا وُجد تعارض يُعيد خطأ 400.

---

## متغيرات البيئة المطلوبة

```
MONGO_URI                 # رابط MongoDB Atlas
JWT_SECRET                # مفتاح JWT (أو secret في utils/auth.js)
DASHBOARD_PASSWORD        # كلمة مرور عبدالملك (fallback)
PASSWORD_YOMNA            # كلمة مرور Yomna (fallback)
PASSWORD_ABDULRAHIM       # كلمة مرور Abdulrahim (fallback)
RESEND_API_KEY            # للإيميلات
NOTIFY_EMAIL              # إيميل التنبيهات (افتراضي: assisting@finsight-sa.com)
GEMINI_API_KEY            # AI chat في الداشبورد
BASE_URL                  # الرابط الأساسي (للإيميلات)، افتراضي: https://barez.pro
NODE_ENV                  # production لتفعيل secure cookies
```
