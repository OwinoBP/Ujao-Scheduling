# Airtable Base Reference: SchoolBusOps

Use this as the build spec when setting up the Airtable base. Field names here must match exactly what's in the Codex prompt — Codex will write code assuming these names, so don't rename anything without updating the prompt too.

Create one base called `SchoolBusOps` with six tables below, in this order (link fields need the target table to exist first).

---

## 1. Schools

| Field name | Type | Notes |
|---|---|---|
| `Name` | Single line text | Primary field |
| `Address` | Single line text | |
| `ContactPerson` | Single line text | |
| `Phone` | Phone number | |

**Sample rows:**

| Name | Address | ContactPerson | Phone |
|---|---|---|---|
| Greenfield Academy | Off Limuru Rd, Nairobi | Mary Wanjiru | 0712345678 |
| St. Andrew's Prep | Karen, Nairobi | James Otieno | 0723456789 |

---

## 2. Buses

| Field name | Type | Notes |
|---|---|---|
| `PlateNumber` | Single line text | Primary field, e.g. `KDA 123X` |
| `Capacity` | Number | Integer |
| `Status` | Single select | Options: `Active`, `Maintenance`, `Inactive` |
| `RouteName` | Single line text | e.g. `Kilimani–Lavington AM` |

**Sample rows:**

| PlateNumber | Capacity | Status | RouteName |
|---|---|---|---|
| KDA 123X | 24 | Active | Kilimani–Lavington |
| KDB 456Y | 18 | Active | Karen–Langata |

---

## 3. Staff

| Field name | Type | Notes |
|---|---|---|
| `Name` | Single line text | Primary field |
| `Role` | Single select | Options: `Admin`, `Driver` |
| `Phone` | Phone number | |
| `Email` | Email | Must match the KV credential key exactly (see below) |
| `AssignedBuses` | Link to another record → **Buses** | Allow linking to multiple records (drivers can have >1 bus) |

**Sample rows:**

| Name | Role | Phone | Email | AssignedBuses |
|---|---|---|---|---|
| Peter Omondi | Admin | 0700111222 | peter@ujao.example | (none needed) |
| Samuel Kiptoo | Driver | 0701222333 | samuel@ujao.example | KDA 123X |
| Grace Achieng | Driver | 0702333444 | grace@ujao.example | KDB 456Y |

⚠️ **No password field here.** Login credentials live in Cloudflare KV, not Airtable. See "Provisioning a staff login" below.

---

## 4. Students

| Field name | Type | Notes |
|---|---|---|
| `Name` | Single line text | Primary field |
| `School` | Link to another record → **Schools** | Single link only |
| `AssignedBus` | Link to another record → **Buses** | Single link only |
| `GuardianName` | Single line text | |
| `GuardianPhone` | Phone number | |
| `PickupAddress` | Single line text | |
| `DropoffAddress` | Single line text | |

**Sample rows:**

| Name | School | AssignedBus | GuardianName | GuardianPhone | PickupAddress | DropoffAddress |
|---|---|---|---|---|---|---|
| Brian Mwangi | Greenfield Academy | KDA 123X | Susan Mwangi | 0711222333 | Kilimani Rd, House 12 | Same as pickup |
| Faith Njeri | St. Andrew's Prep | KDB 456Y | Daniel Njeri | 0722333444 | Karen Rd, Apt 4B | Same as pickup |

---

## 5. TripLogs

One record per student **per day** — AM and PM status both live on this single row.

| Field name | Type | Notes |
|---|---|---|
| `Student` | Link to another record → **Students** | Single link |
| `Bus` | Link to another record → **Buses** | Single link |
| `Driver` | Link to another record → **Staff** | Single link |
| `Date` | Date | No time component needed |
| `AMStatus` | Single select | Options: `Pending`, `PickedUp`, `Absent` |
| `AMTimestamp` | Date with time | Set by server, not user |
| `PMStatus` | Single select | Options: `Pending`, `DroppedOff`, `Absent` |
| `PMTimestamp` | Date with time | Set by server, not user |

**Sample row:**

| Student | Bus | Driver | Date | AMStatus | AMTimestamp | PMStatus | PMTimestamp |
|---|---|---|---|---|---|---|---|
| Brian Mwangi | KDA 123X | Samuel Kiptoo | 2026-06-22 | PickedUp | 2026-06-22 06:42 | Pending | |

This table grows by (number of students) rows per day — that's expected and fine for Airtable at MVP scale. If you outgrow Airtable's row limits later, this is the table to watch.

---

## 6. Incidents

Separate table, only created when something actually happens (not a row-per-day default).

| Field name | Type | Notes |
|---|---|---|
| `Student` | Link to another record → **Students** | Single link |
| `Bus` | Link to another record → **Buses** | Single link |
| `Driver` | Link to another record → **Staff** | Single link |
| `Date` | Date | |
| `Timestamp` | Date with time | Set by server |
| `Description` | Long text | |
| `Severity` | Single select | Options: `Low`, `Medium`, `High` |

**Sample row:**

| Student | Bus | Driver | Date | Timestamp | Description | Severity |
|---|---|---|---|---|---|---|
| Faith Njeri | KDB 456Y | Grace Achieng | 2026-06-22 | 2026-06-22 15:10 | Student felt unwell on the bus, guardian notified and picked up early | Medium |

---

## Provisioning a staff login (manual, do this after adding a Staff record)

Airtable does NOT store passwords. After creating a Staff record:

1. Note the Airtable record ID (e.g. `recXXXXXXXXXXXXXX`) — visible in the URL when you open the record, or via the API.
2. Generate a bcrypt hash for their password (Codex's README will include a small script for this).
3. Add a KV entry:
   ```
   wrangler kv:key put --binding=STAFF_CREDENTIALS "staff:samuel@ujao.example" '{"passwordHash":"$2a$...","role":"Driver","airtableStaffId":"recXXXXXXXXXXXXXX"}'
   ```
4. The `Email` in this KV key must match the `Email` field on the Staff record exactly — that's how the Worker links a logged-in session back to Airtable data.

This is a two-step process by design for the MVP (Airtable record + KV entry). If driver turnover becomes frequent, this is the first thing worth automating later — e.g. an admin-only "create driver" form that does both steps at once.

---

## Getting your Airtable API credentials (for `.dev.vars`)

- `AIRTABLE_BASE_ID` — found in Airtable's API docs for your base (Help → API documentation), starts with `app...`
- `AIRTABLE_PAT` — create a Personal Access Token at airtable.com/create/tokens, scope it to this base only, with `data.records:read` and `data.records:write` permissions. Don't use a full-account token.
