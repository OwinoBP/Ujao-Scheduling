# Codex Build Prompt: School Bus Tracking MVP

## Project overview
Build an MVP web app for a school bus pickup/dropoff company. Two user roles log in: **Admin** (full access to all data) and **Driver** (can only log trip status and incidents for students on their assigned buses). Admins manage schools, buses, staff, and students. Drivers use a mobile-friendly view to mark students picked up/dropped off and log incidents.

## Stack
- **Backend**: Cloudflare Workers using the **Hono** framework (NOT Express — Workers don't support Node's HTTP server model). Use `hono/jwt` for auth.
- **Data store**: Airtable, accessed via the Airtable REST API (no Airtable JS SDK — use fetch calls with a Personal Access Token stored as a Worker secret, `AIRTABLE_PAT`).
- **Credentials store**: Cloudflare KV (binding name `STAFF_CREDENTIALS`) — staff login credentials are NOT stored in Airtable. Airtable only stores staff profile/business data.
- **Frontend**: Plain HTML/CSS/vanilla JS (no framework), mobile-first responsive design. Hosted on Cloudflare Pages.
- **Auth**: JWT in an httpOnly, Secure, SameSite=Strict cookie. Worker validates JWT on every protected route.

## Airtable schema (base name: `SchoolBusOps`)

### Schools
- `Name` (text)
- `Address` (text)
- `ContactPerson` (text)
- `Phone` (text)

### Buses
- `PlateNumber` (text, primary)
- `Capacity` (number)
- `Status` (single select: Active, Maintenance, Inactive)
- `RouteName` (text)

### Staff
- `Name` (text)
- `Role` (single select: Admin, Driver)
- `Phone` (text)
- `Email` (text) — used to look up KV credential record, must match KV key
- `AssignedBuses` (link to Buses, allow multiple — drivers can have more than one bus)

### Students
- `Name` (text)
- `School` (link to Schools, single)
- `AssignedBus` (link to Buses, single)
- `GuardianName` (text)
- `GuardianPhone` (text)
- `PickupAddress` (text)
- `DropoffAddress` (text)

### TripLogs
- `Student` (link to Students, single)
- `Bus` (link to Buses, single)
- `Driver` (link to Staff, single)
- `Date` (date)
- `AMStatus` (single select: Pending, PickedUp, Absent)
- `AMTimestamp` (datetime)
- `PMStatus` (single select: Pending, DroppedOff, Absent)
- `PMTimestamp` (datetime)
- One record per student per day. AM and PM status/timestamp live on the same row.

### Incidents
- `Student` (link to Students, single)
- `Bus` (link to Buses, single)
- `Driver` (link to Staff, single)
- `Date` (date)
- `Timestamp` (datetime)
- `Description` (long text)
- `Severity` (single select: Low, Medium, High)

## Auth design
- Staff credentials live in Cloudflare KV, NOT Airtable. Key format: `staff:{email}`. Value (JSON): `{ "passwordHash": "...", "role": "Admin" | "Driver", "airtableStaffId": "rec..." }`.
- Use bcrypt-compatible hashing that works in Workers runtime (use `bcryptjs`, which is pure JS and Workers-compatible — do NOT use `bcrypt` which relies on native bindings).
- Login flow: POST `/api/login` with `{email, password}` → look up KV → verify hash → issue JWT containing `{email, role, airtableStaffId}` → set as httpOnly cookie → return success.
- Logout: clear cookie.
- Middleware: every `/api/*` route except `/api/login` requires valid JWT cookie. Role-based middleware: Admin routes check `role === 'Admin'`; Driver routes check `role === 'Driver'` AND verify the requested bus/student is actually in that driver's `AssignedBuses` before allowing writes.

## API routes needed

### Admin only
- `GET/POST/PATCH/DELETE /api/schools`
- `GET/POST/PATCH/DELETE /api/buses`
- `GET/POST/PATCH/DELETE /api/staff` (writes to Airtable Staff table; creating a new staff member does NOT auto-create their KV credential — note this as a manual follow-up step for the admin, surface a message in the UI reminding them to provision login separately)
- `GET/POST/PATCH/DELETE /api/students`
- `GET /api/triplogs` (all, with filters by date/bus/school)
- `GET /api/incidents` (all, with filters)

### Driver (scoped to their own assigned buses)
- `GET /api/driver/students` — students on this driver's assigned buses only
- `GET /api/driver/triplogs?date=YYYY-MM-DD` — today's trip logs for their students, auto-creating a Pending row per student if none exists for the date
- `PATCH /api/driver/triplogs/:id` — update AM or PM status + timestamp (server sets timestamp, not client)
- `POST /api/driver/incidents` — log new incident for a student on their bus

## Frontend pages
1. **Login page** — email + password, mobile-first, large tap targets.
2. **Admin dashboard** — tabbed or sidebar nav: Schools / Buses / Staff / Students / Trip Logs / Incidents. Each tab: table view + add/edit form (modal or inline). Keep it functional over pretty for MVP — but must work cleanly on mobile (collapsible nav, responsive tables that become stacked cards on small screens).
3. **Driver view** — single-page, mobile-first (this is the primary use case, optimize hardest here):
   - List of today's students across their assigned buses, grouped by bus/route.
   - Each student row: name, pickup/dropoff address, large tap-friendly buttons for AM status (Picked Up / Absent) and PM status (Dropped Off / Absent).
   - "Report Incident" button per student → opens simple form (description, severity) → submits to `/api/driver/incidents`.
   - Should work well on a low-end Android phone on patchy mobile data — keep JS bundle small, avoid heavy frameworks, show clear loading/saved states since connectivity may be unreliable.

## Build instructions for Codex
1. Scaffold two separate directories: `/worker` (Cloudflare Worker + Hono backend) and `/frontend` (static HTML/CSS/JS for Cloudflare Pages).
2. In `/worker`, set up `wrangler.toml` with KV namespace binding `STAFF_CREDENTIALS` and required secrets (`AIRTABLE_PAT`, `AIRTABLE_BASE_ID`, `JWT_SECRET`) referenced but not hardcoded — use `.dev.vars.example` to show what's needed locally.
3. Write a small Airtable client helper module (`/worker/src/airtable.js`) wrapping fetch calls to `https://api.airtable.com/v0/{baseId}/{tableName}` for list/get/create/update/delete, handling Airtable's pagination (`offset` param) for list calls.
4. Implement auth middleware first, then build routes table-by-table (Schools → Buses → Staff → Students → TripLogs → Incidents).
5. Build the driver mobile view as its own minimal HTML page (`/frontend/driver.html`) separate from the admin dashboard (`/frontend/admin.html`), each with their own JS file — don't combine into one giant SPA for this MVP, keep it simple.
6. Add a root `/frontend/index.html` that just redirects to login, and after login redirects by role (Admin → admin.html, Driver → driver.html).
7. Include a `README.md` covering: Airtable base setup (table/field names matching schema above), how to provision a staff KV credential manually (sample `wrangler kv:key put` command), local dev with `wrangler dev`, and deploy steps for both Worker and Pages.
8. Do NOT implement parent-facing features, SMS/notifications, payment, or route optimization — explicitly out of scope for this MVP.

## Non-functional requirements
- Mobile-first CSS throughout (driver view especially) — test against a 375px viewport as baseline.
- No external CSS/JS frameworks required; plain CSS is fine, but keep it organized (one shared stylesheet, mobile breakpoints).
- Handle Airtable API failures gracefully (rate limits, network errors) with user-visible error states, not silent failures or blank screens.
- Keep secrets out of any committed file — `.gitignore` must exclude `.dev.vars` and any `wrangler.toml` sections containing literal secret values.
