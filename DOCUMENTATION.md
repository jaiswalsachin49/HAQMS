# HAQMS — Internship Submission Documentation

**Candidate**: Sachin Jaiswal  
**Date**: May 2026  
**Repository**: [GitHub Repository](https://github.com/jaiswalsachin49/HAQMS.git)  
**Live Frontend**: [Live Frontend](https://haqms-two-orpin.vercel.app/)  
**Live Backend API**: [Render API](https://haqms-t4tu.onrender.com)  

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Challenge 1: Security Audit](#challenge-1-security-audit)
3. [Challenge 2: Backend Performance & Concurrency](#challenge-2-backend-performance--concurrency)
4. [Challenge 3: Database & Schema Optimization](#challenge-3-database--schema-optimization)
5. [Challenge 4: Frontend Memory & React Optimization](#challenge-4-frontend-memory--react-optimization)
6. [Challenge 5: Incomplete Feature Delivery](#challenge-5-incomplete-feature-delivery)
7. [Bonus: Deep Audit Polish](#bonus-deep-audit-polish)
8. [Files Modified](#files-modified)

---

## Executive Summary

This document details my systematic audit and resolution of all **17 intentional vulnerabilities** across security, performance, concurrency, database optimization, frontend memory management, and feature delivery in the HAQMS codebase.

Every fix was made with production-grade architectural reasoning — not quick hacks. The approach prioritized **database-level enforcement** over application-level checks, **atomic transactions** over sequential operations, and **ORM-based parameterization** over raw SQL.

---

## Challenge 1: Security Audit

### 1.1 Credential Logging (Cleartext Password Leak)

**File**: `backend/src/routes/auth.js`

**Bug Found**: The `/register` and `/login` routes contained `console.log(req.body)` statements that dumped the entire request payload — including raw plaintext passwords — into server logs. Additionally, the registration response returned the full user object from the database, including the hashed password.

**Fix Applied**:
- Removed all `console.log` statements that logged request bodies containing passwords.
- On registration, destructured the password out of the user object before sending the response:
```js
const { password: _, ...userWithoutPassword } = user;
res.status(201).json({ message: 'User registered successfully', user: userWithoutPassword });
```

**Architectural Reasoning**: Credential logging is a OWASP Top 10 violation (A07:2021 – Security Logging and Monitoring Failures). In production, server logs are often shipped to third-party aggregation services (Datadog, CloudWatch), meaning plaintext passwords would be stored in multiple unencrypted locations. The fix ensures secrets never leave the application boundary.

---

### 1.2 Leaky JWT Token Verification

**File**: `backend/src/middleware/auth.js`

**Bug Found**: The JWT verification middleware was configured with `{ ignoreExpiration: true }`, meaning tokens never expired — even tokens that were months old would be accepted as valid.

**Fix Applied**:
- Removed the `ignoreExpiration: true` flag so `jwt.verify()` enforces the standard `exp` claim:
```js
// Before (vulnerable):
const decoded = jwt.verify(token, JWT_SECRET, { ignoreExpiration: true });

// After (secured):
const decoded = jwt.verify(token, JWT_SECRET);
```

**Architectural Reasoning**: Without expiration enforcement, a stolen JWT grants permanent access. The existing `expiresIn: '365d'` signing parameter becomes meaningless if verification ignores it. This fix restores the entire JWT lifecycle.

---

### 1.3 SQL Injection in Doctor Search

**File**: `backend/src/routes/doctors.js`

**Bug Found**: The doctor search endpoint used raw string concatenation passed to `prisma.$queryRawUnsafe()`:
```js
// VULNERABLE: Direct string interpolation
query += "name ILIKE '%" + search + "%'";
const doctors = await prisma.$queryRawUnsafe(query);
```
An attacker could inject `'; DROP TABLE "Doctor"; --` via the search parameter.

**Fix Applied**:
- Replaced the entire raw SQL approach with Prisma's type-safe ORM queries:
```js
const where = {};
if (search) {
  where.name = { contains: search, mode: 'insensitive' };
}
const doctors = await prisma.doctor.findMany({ where });
```

**Architectural Reasoning**: Parameterized queries are the industry standard for preventing SQL injection (OWASP A03:2021). By using Prisma's ORM, the query parameters are automatically escaped at the driver level, making injection structurally impossible regardless of user input.

---

### 1.4 Bypassed Admin Authorization

**File**: `backend/src/middleware/auth.js`

**Bug Found**: The `authorizeAdminOnlyLegacy` middleware — which protects destructive endpoints like `DELETE /api/patients/:id` — had its role check commented out, allowing any authenticated user (receptionist or doctor) to delete patient records.

**Fix Applied**:
- Restored the role-based access control check:
```js
const authorizeAdminOnlyLegacy = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized.' });
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Access denied. Admin only.' });
  }
  next();
};
```

**Architectural Reasoning**: This is a classic Broken Access Control vulnerability (OWASP A01:2021). In a hospital system, allowing non-admin users to delete patient records is a HIPAA-level compliance failure. The fix enforces the principle of least privilege at the middleware layer.

---

## Challenge 2: Backend Performance & Concurrency

### 2.1 N+1 Database Query in Appointments

**File**: `backend/src/routes/appointments.js`

**Bug Found**: The `GET /api/appointments` endpoint fetched all appointments, then looped through each one to execute two separate `findUnique` calls (one for Patient, one for Doctor). With 100 appointments, this created 201 database round-trips.

**Fix Applied**:
- Used Prisma's `include` feature to eagerly load relations in a single query:
```js
const detailedAppointments = await prisma.appointment.findMany({
  where,
  orderBy: { appointmentDate: 'asc' },
  include: {
    patient: { select: { id: true, name: true, phoneNumber: true, age: true, medicalHistory: true } },
    doctor: { select: { id: true, name: true, specialization: true } }
  }
});
```

**Architectural Reasoning**: Prisma's `include` translates to optimized SQL JOINs, reducing 201 queries to 1. The `select` clause further limits the data transferred, reducing payload size and memory usage.

---

### 2.2 Sequential Async Calls (Event-Loop Blocking)

**Files**: `backend/src/routes/doctors.js`, `backend/src/routes/reports.js`

**Bug Found**: Independent database aggregation calls (`count()`, `aggregate()`) were executed sequentially with `await`, blocking the Node.js event loop unnecessarily. The reports endpoint also contained an artificial `setTimeout` delay.

**Fix Applied**:
- Wrapped independent queries in `Promise.all()` for concurrent execution:
```js
const [totalDoctors, surgeonsCount, averageFee, highestExperience] = await Promise.all([
  prisma.doctor.count(),
  prisma.doctor.count({ where: { department: 'Surgery' } }),
  prisma.doctor.aggregate({ _avg: { consultationFee: true } }),
  prisma.doctor.aggregate({ _max: { experience: true } })
]);
```
- Removed the artificial `setTimeout` delay from the reports endpoint.

**Architectural Reasoning**: Since these queries have no data dependency on each other, running them sequentially wastes wall-clock time equal to the sum of all query durations. `Promise.all()` reduces it to the duration of the slowest single query. This is critical under hospital-scale concurrent loads.

---

### 2.3 Check-in Token Race Condition

**File**: `backend/src/routes/queue.js`

**Bug Found**: Token generation used a read-then-write pattern: (1) read the max token number, (2) sleep 350ms, (3) insert max+1. Under concurrent check-ins, two requests could read the same max and both insert the same token number.

**Fix Applied**:
- Wrapped the read and write inside a Prisma `$transaction`:
```js
const newToken = await prisma.$transaction(async (tx) => {
  const maxTokenResult = await tx.queueToken.aggregate({
    where: { doctorId, createdAt: { gte: today } },
    _max: { tokenNumber: true },
  });
  const nextTokenNumber = (maxTokenResult._max.tokenNumber || 0) + 1;
  return await tx.queueToken.create({
    data: { tokenNumber: nextTokenNumber, patientId, doctorId, ... },
  });
});
```
- Removed the artificial 350ms `setTimeout` delay.

**Architectural Reasoning**: Database transactions provide ACID isolation. By wrapping the aggregate and insert in `$transaction`, PostgreSQL guarantees that no two concurrent transactions can read the same max value and both succeed. This is the standard pattern for sequence generation without auto-increment columns.

---

## Challenge 3: Database & Schema Optimization

### 3.1 Double-Booking Schema Vulnerability

**File**: `backend/prisma/schema.prisma`

**Bug Found**: The `Appointment` model had no unique constraint preventing the same doctor from being booked at the exact same time slot. The application-level check (`findFirst`) was easily bypassed by concurrent requests.

**Fix Applied**:
```prisma
model Appointment {
  @@unique([doctorId, appointmentDate])
}
```

**Architectural Reasoning**: Application-level exact-time checks are inherently vulnerable to race conditions (TOCTOU — Time-of-Check to Time-of-Use) and fail to catch near-duplicates. The system is now protected at two levels:
1. **Application Layer**: A 30-minute time-slot window (`gte: windowStart, lte: windowEnd`) prevents near-duplicate bookings like `10:00:00` and `10:00:01` while providing a user-friendly error message.
2. **Database Layer**: The `@@unique` constraint acts as the absolute last line of defense, enforced atomically by PostgreSQL, making exact duplicates structurally impossible regardless of concurrent request timing.

---

### 3.2 Missing Foreign Key Indices

**File**: `backend/prisma/schema.prisma`

**Bug Found**: Foreign key columns (`patientId`, `doctorId`) and frequently filtered columns (`status`, `appointmentDate`) had no indices, forcing PostgreSQL to perform full sequential table scans on every JOIN and WHERE clause.

**Fix Applied**:
```prisma
model Appointment {
  @@index([patientId])
  @@index([doctorId])
  @@index([status])
  @@index([appointmentDate])
}

model QueueToken {
  @@index([doctorId, createdAt])
  @@index([status])
}
```

**Architectural Reasoning**: Without indices, query complexity is O(n) per table scan. With B-tree indices, lookups become O(log n). For a hospital with thousands of daily appointments, this is the difference between 50ms and 5-second query times.

---

### 3.3 In-Memory Pagination

**File**: `backend/src/routes/patients.js`

**Bug Found**: The endpoint fetched the entire `Patient` table into Node.js memory, then used JavaScript `Array.filter()` and `Array.slice()` for search and pagination. With 10,000+ patients, this would exhaust server memory.

**Fix Applied**:
```js
const [paginatedResult, totalPatients] = await Promise.all([
  prisma.patient.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    skip: offset,
    take: limit,
  }),
  prisma.patient.count({ where }),
]);
```

**Architectural Reasoning**: SQL `OFFSET`/`LIMIT` (Prisma's `skip`/`take`) delegates pagination to the database engine, which is optimized for this operation. Only the requested page of results travels over the network, reducing memory usage from O(total_rows) to O(page_size).

---

## Challenge 4: Frontend Memory & React Optimization

### 4.1 Severe Memory Leak on Queue Board

**File**: `frontend/src/app/queue/page.js`

**Bug Found**: The `useEffect` hook created a `setInterval` polling every 3 seconds but never cleared it on component unmount. Navigating away and back created multiple overlapping intervals, each consuming memory and making duplicate API calls.

**Fix Applied**:
```js
useEffect(() => {
  fetchQueueData();
  const intervalId = setInterval(() => {
    fetchQueueData();
    setRefreshCount((prev) => prev + 1);
  }, 3000);
  return () => clearInterval(intervalId); // Cleanup on unmount
}, []);
```

**Architectural Reasoning**: React's `useEffect` cleanup function is the standard mechanism for preventing resource leaks. Without it, each mount creates an orphaned interval that persists in memory, eventually causing browser tab crashes under repeated navigation.

---

### 4.2 Unnecessary Re-renders from Search Keystroke Spam

**File**: `frontend/src/app/dashboard/page.js`

**Bug Found**: The patient search `useEffect` was directly tied to the raw `patientSearch` state, meaning every keystroke triggered a full API call and 1000+ line component re-render.

**Fix Applied**:
```js
const [debouncedPatientSearch, setDebouncedPatientSearch] = useState('');
useEffect(() => {
  const handler = setTimeout(() => setDebouncedPatientSearch(patientSearch), 500);
  return () => clearTimeout(handler);
}, [patientSearch]);
```
The API `useEffect` now depends on `debouncedPatientSearch` instead of the raw input.

**Architectural Reasoning**: Debouncing ensures the API call only fires 500ms after the user stops typing. Typing "John" no longer fires 4 API calls (`J`, `Jo`, `Joh`, `John`) — it fires exactly 1. This reduces server load by ~75% for a typical search interaction.

---

### 4.3 NULL Value Application Crash

**File**: `frontend/src/app/dashboard/page.js`

**Bug Found**: When a doctor viewed a patient with a `null` medical history (e.g., Clark Kent), the code called `.toUpperCase()` on `null`, crashing the entire React component tree with `TypeError: Cannot read properties of null (reading 'toUpperCase')`.

**Fix Applied**:
```js
{(selectedPatientHistory.medicalHistory || 'No medical history recorded').toUpperCase()}
```

**Architectural Reasoning**: In a hospital system, new patients frequently have no prior medical history. The UI must gracefully handle nullable database fields. The `||` fallback pattern provides a user-friendly default while preventing runtime crashes.

---

## Challenge 5: Incomplete Feature Delivery

### 5.1 Missing Diagnostic Reports Page (404)

**File**: `frontend/src/app/patients/[id]/history-records/page.js` **(NEW)**

**Bug Found**: Clicking "View Diagnostic Reports Details (Legacy App)" on any patient profile resulted in a 404 error because the dynamic route did not exist.

**Fix Applied**:
- Created the full Next.js dynamic route page from scratch.
- The page fetches patient data from `GET /api/patients/:id` using the JWT token from localStorage.
- Renders the patient's clinical profile, medical history, and past appointment records.
- Styled consistently with the existing glassmorphism design system.
- Includes proper loading states, error handling, and a back-navigation button.

**Architectural Reasoning**: Next.js App Router uses folder-based routing where `[id]` segments become dynamic URL parameters accessible via `useParams()`. The page reuses the existing `/api/patients/:id` endpoint (which already includes appointments via Prisma `include`), avoiding the need for new backend routes.

---

## Bonus: Deep Audit Polish

Beyond the 5 required challenges, I identified and fixed additional edge-case vulnerabilities:

### Global Error Handler Data Leak
- **File**: `backend/src/index.js`
- **Bug**: The Express error handler leaked raw `err.message` to clients in all environments.
- **Fix**: Conditionally return error details only in `development` mode.

### Inconsistent API Responses & Missing Validation
- **File**: `backend/src/routes/auth.js`
- **Bug**: Login returned `{ status: 'success', data: { token, user } }` while other endpoints returned flat objects. No email format or password length validation existed.
- **Fix**: Standardized all responses to flat format. Added email regex validation and 8-character minimum password length on both server and client.

### Frontend HTML5 Validation Bypass
- **File**: `frontend/src/app/login/page.js`
- **Bug**: Email input used `type="text"` to bypass native browser validation.
- **Fix**: Restored `type="email"` and added client-side password length checks.

### Database Error Stack Trace Leaks
- **Files**: `backend/src/routes/*.js`, `backend/src/middleware/auth.js`
- **Bug**: Multiple endpoints leaked raw database stack traces, `error.message`, and JWT validation failure specifics to the client.
- **Fix**: Stripped all `details: error.message` payloads from `500` and `401` responses, replacing them with generic, safe failure strings.

### Missing Phone Number Validation
- **File**: `backend/src/routes/patients.js`
- **Bug**: Patient registration accepted random strings for the phone number field (e.g. "abc").
- **Fix**: Implemented robust regex validation (`/^\+?[\d\s-]{10,15}$/`) to enforce valid international or local phone number formats.

### Broad CORS & Unhandled Promise Rejections
- **File**: `backend/src/index.js`
- **Bug**: The application allowed all origins (`cors()`) and intentionally swallowed unhandled promise rejections without exiting. The API also broadcasted its version as `1.0.0-deliberate-bugs`.
- **Fix**: Restored strict CORS (`process.env.FRONTEND_URL`), added `process.exit(1)` for proper crash-loop stability on unhandled rejections, and updated the version to `1.0.0-secured`.

### Broken Doctor Dashboard Linking
- **File**: `frontend/src/app/dashboard/page.js`
- **Bug**: The Doctor dashboard tried to fetch appointments using `d.userId === user.id`. However, the `Doctor` schema does not contain a `userId` foreign key, causing the lookup to fail silently and render empty tabs for doctors.
- **Fix**: Updated the lookup to match by name (`d.name === user?.name`), restoring visibility of appointments and queue for the logged-in doctor.

### React Rules of Hooks Violation on Logout
- **File**: `frontend/src/app/dashboard/page.js`
- **Bug**: Clicking "Logout" caused Next.js to crash with a "Rendered fewer hooks than expected" error because an early return (`if (!user) return null`) was placed *before* other React hooks (`useState`, `useEffect`).
- **Fix**: Moved the early return below all hooks and implemented optional chaining (`user?.role`) to gracefully handle null states during unmount.

### Database Error Stack Trace Leaks
- **Files**: `backend/src/routes/*.js`, `backend/src/middleware/auth.js`
- **Bug**: Multiple endpoints leaked raw database stack traces, `error.message`, and JWT validation failure specifics to the client.
- **Fix**: Stripped all `details: error.message` payloads from `500` and `401` responses, replacing them with generic, safe failure strings.

### Missing Phone Number Validation
- **File**: `backend/src/routes/patients.js`
- **Bug**: Patient registration accepted random strings for the phone number field (e.g. "abc").
- **Fix**: Implemented robust regex validation (`/^\+?[\d\s-]{10,15}$/`) to enforce valid international or local phone number formats.

---

## Files Modified

| File | Category | Changes |
|------|----------|---------|
| `backend/src/routes/auth.js` | Security | Removed password logging, added validation, standardized responses |
| `backend/src/middleware/auth.js` | Security | Enforced JWT expiration, restored admin role check |
| `backend/src/routes/doctors.js` | Security + Performance | Fixed SQL injection, parallelized aggregations |
| `backend/src/routes/appointments.js` | Performance | Resolved N+1 query with Prisma `include` |
| `backend/src/routes/queue.js` | Concurrency | Atomic token generation via `$transaction` |
| `backend/src/routes/reports.js` | Performance | Parallelized aggregations with `Promise.all` |
| `backend/src/routes/patients.js` | Performance | Database-level pagination with `skip`/`take` |
| `backend/src/index.js` | Security | Secured global error handler |
| `backend/prisma/schema.prisma` | Database | Added `@@unique`, `@@index` constraints |
| `frontend/src/app/queue/page.js` | Memory | Fixed `setInterval` leak, environment variable |
| `frontend/src/app/dashboard/page.js` | React | Debounced search, null crash fix |
| `frontend/src/app/login/page.js` | Validation | Restored HTML5 email type, password length check |
| `frontend/src/context/AuthContext.js` | Config | Environment variable for API URL, flat response parsing |
| `frontend/src/app/patients/[id]/history-records/page.js` | Feature | **NEW** — Built missing diagnostic reports page |
