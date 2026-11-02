# Centralized Hospital Bed & Emergency Resource Management System (CHR-MS)

A full-stack, enterprise-grade clinical management dashboard built with **Next.js 14**, **React 18**, **Tailwind CSS**, and **Lucide Icons**, directly interfacing with local **PostgreSQL** (`hospital_db`) on `localhost:5432` using native node-postgres (`pg`) connection pooling.

---

## 🏥 Architecture & Tech Stack

- **Frontend & App Framework**: Next.js 14 (App Router) + React 18 + TypeScript
- **Motion & 3D**: Framer Motion, three.js via React Three Fiber + drei + postprocessing (3D hospital digital twin and occupancy vials)
- **Styling**: Tailwind CSS + Custom Healthcare Tokens + Lucide React Icons
- **Database Driver**: Native `pg` (node-postgres) Connection Pool with parameterized queries (`$1, $2, ...`)
- **Database Engine**: PostgreSQL 15 or newer on `localhost:5432` (`hospital_db`). Needs `btree_gist`, `pgcrypto` and `pg_trgm`, which ship with every standard install. Views use `security_invoker`, which needs PostgreSQL 15+.
- **Constraint Safety**: Catching & formatting PostgreSQL exclusion constraints (`ex_no_double_bed_booking` - `23P01`), unique constraints (`23505`), and check constraints (`23514`) into real-time clinical alerts.

---

## 🚀 Getting Started (Quick Setup for Teammate / Evaluator)

### 1. Environment Setup

Copy `.env.example` to `.env.local` and set your local PostgreSQL password:
```bash
cp .env.example .env.local
```
Edit `.env.local` with your PostgreSQL password:
```env
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=YOUR_LOCAL_PASSWORD
DB_NAME=hospital_db
DATABASE_URL=postgresql://postgres:YOUR_LOCAL_PASSWORD@localhost:5432/hospital_db
```

### 2. Install Dependencies & Initialize Database

Run the automated database setup script to create `hospital_db`, load the complete normalized schema (23 tables, GiST temporal exclusion constraints, views, a materialized view, triggers, stored procedures, row-level security and a hash-chained audit log), seed clinical data, and load the three real-world datasets in `database/datasets/` (about 5 seconds):

```bash
# Install dependencies
npm install

# Run automated one-command database provisioning
npm run db:setup

# Start the Development Server
npm run dev
```

Visit the dashboard in your browser:
**`http://localhost:3000`**

You land on the staff sign-in page. Pick a badge from the badge rack (or type a badge ID such as `DOC-1002-TN`), tap it on the reader, then enter the demo PIN **`246810`**.

> `npm run db:setup` drops and recreates the `public` schema, so it resets all data, including staff sessions and the login audit log.

---

## 🩺 Core Views Built

### 1. Bed Occupancy & Triage Dashboard (`/`)
- **Clinical Metric Cards**:
  - Total Physical Beds & Ready Sanitized Count
  - Currently Occupied Beds & Inpatient Census
  - Available ICU / Critical Beds
  - Critical Triage Count (ESI 1: Resuscitation & ESI 2: Emergent)
- **Visual Bed Grid**:
  - Interactive cards displaying Room Number, Bed Label, Ward Type (ICU / General / Pediatric / Semi-Private).
  - High-contrast equipment badges: Ventilator (`Wind`), O2 Port (`Gauge`), and Daily Tariff.
  - Operational Status Pills: `Available` (Emerald), `Occupied` (Rose), `Sanitizing` (Amber), `Out-Of-Service` (Slate).
  - Inpatient Card Details: Patient name, NHID, blood group, attending physician, length of stay, and diagnosis.
  - Interactive Action Buttons:
    - **Admit Patient Here** (Available)
    - **Discharge & Bill** (Occupied)
    - **Mark Cleaned & Available** (Sanitizing)
- **Filters**:
  - Department dropdown filter
  - Operational status filter pills (All, Available, Occupied, Sanitizing)
  - Ward type filter (ICU, General, Pediatric, Semi-Private)
  - Real-time room / bed / patient search

### 2. Emergency Admission Desk (`/admissions`)
- **Intake Form**:
  - **Select Patient**: Searchable dropdown of registered patients or click **`+ Quick-Register New Patient`** for rapid intake.
  - **Admitting Physician**: Filtered strictly by `is_on_duty = true` with consultation fees and department affiliations.
  - **Bed Dropdown**: Pre-populates 'Available' sanitized beds with room, label, ward type, tariff, and equipment badges.
  - **Emergency Severity Index (ESI) Slider**: Interactive 1–5 triage priority slider with clinical guidance:
    - `ESI 1`: Resuscitation (Immediate life-saving intervention)
    - `ESI 2`: Emergent (High risk, severe pain, or unstable vitals)
    - `ESI 3`: Urgent (Multiple clinical resources needed)
    - `ESI 4`: Less Urgent (Single resource needed)
    - `ESI 5`: Non-Urgent (Routine clinic care)
  - **Admission Diagnosis**: Clinical notes textarea.
- **Constraint Handling (`ex_no_double_bed_booking`)**:
  - Toggle **"Show Occupied Beds (Test Conflict)"** allows testing what happens if an occupied bed is selected.
  - Submitting an occupied bed triggers the PostgreSQL GiST exclusion constraint (`23P01`). The backend rolls back the transaction and returns a structured 409 error.
  - The UI catches this and displays a **prominent red error toast** and a **Clinical Alert Dialog** explaining the violation.

### 3. Patient Discharge & Billing Terminal (`/billing`)
- **Active Inpatients Census**:
  - Real-time census table displaying patient name, NHID, bed assignment, attending physician, admission date, and calculated length of stay (days and hours).
- **Discharge & Generate Bill Modal**:
  - Automatically calculates bed charges: `billable_days × daily_tariff`.
  - Input fields for **Clinical Procedure Charges** and **Pharmacy Charges**.
  - **Insurance Claim Approved** deduction input.
  - **Hospital Concession Discount Slider** (0% to 50% max, adhering to DB `chk_discount`).
  - Real-time billing summary:
    $$\text{Gross Amount} = \text{Bed} + \text{Procedures} + \text{Pharmacy}$$
    $$\text{Net Payable} = \text{Gross} - \text{Insurance} - (\text{Gross} \times \text{Discount}\%)$$
  - **Atomic Transaction**:
    1. Updates `admissions` status to `'Discharged'` and sets `discharge_time = CURRENT_TIMESTAMP`.
    2. Updates `wards_beds` status to `'Available'` (or `'Sanitizing'`).
    3. Inserts into `billing` table (with `gross_amount` and `net_patient_payable` computed by PostgreSQL generated columns).
- **Hospital Invoice Receipt**:
  - Generates official discharge clearance invoice with print-friendly layout.
  - Historical invoices tab to audit past bills.

### 4. Departmental Capacity & Analytics (`/analytics`)
- **SQL Aggregate Summary Table**:
  - Shows department-wise bed occupancy rate %, active admissions, gross revenue billed, net patient collections, and on-duty physician staffing.
  - Dynamic progress bars with threshold color coding (>80% warning).
- **Specialty Ward Breakdown**:
  - ICU vs General vs Pediatric vs Semi-Private distribution, ventilator counts, and average tariffs.
- **KPI Summary Cards**:
  - Hospital-wide occupancy %, total inpatients, gross billed, and net collections.

---

## 🪪 Staff Sign-In (Badge + Pulse-PIN)

Every page and API route requires a staff session.

- **Lanyard badge**: a draggable ID badge that swings on a spring. Drag it onto the NFC reader (or press Continue) to tap in. The badge colour follows the role encoded in the badge ID (`DOC` doctor, `NUR` nurse, `BIL` billing, `ADM` admin).
- **Pulse-PIN**: a 6-digit PIN keyed on a live ECG monitor. Each digit is a heartbeat; a correct PIN settles into sinus rhythm, a wrong one shows fibrillation, and a locked badge flatlines.
- **Verified inside PostgreSQL**: `fn_authenticate_staff()` checks the bcrypt hash with `pgcrypto` (`crypt()` / `gen_salt('bf')`), locks a badge for 15 minutes after 5 wrong PINs, and writes every attempt to `login_audit`. Unknown badges and wrong PINs return the same answer, so badge IDs cannot be probed.
- **Sessions**: a random token goes into an `httpOnly` cookie; only its SHA-256 hash is stored in `staff_sessions`. Standard sessions last one 8-hour shift. Signing out revokes the session row.
- **Break-glass emergency access**: in an emergency a valid badge can skip the PIN by recording a reason (10+ characters). Access lasts 15 minutes, shows a red countdown banner on every page, is enforced by `chk_break_glass_window`, and is limited to 2 uses per badge per day.

| Table | Purpose |
|---|---|
| `staff_accounts` | Badge ID, name, role, optional link to `doctors`, bcrypt PIN hash (`chk_pin_is_bcrypt`) |
| `staff_sessions` | Hashed session tokens, access mode (`standard` / `break_glass`), expiry, revocation |
| `login_audit` | Every sign-in, failure, lock-out, break-glass grant and sign-out with IP and user agent |

Seeded badges (PIN `246810`): `DOC-1001-TN`, `DOC-1002-TN`, `NUR-2001`, `BIL-3001`, `ADM-0001`.

---

## 🌍 Real-World Datasets (loaded into hospital_db)

The project ships compact extracts of three public datasets in `database/datasets/`. `npm run db:setup` loads them; `scripts/datasets/build_datasets.py` rebuilds them from the raw files.

| Table | Rows | Source | Used for |
|---|---|---|---|
| `nhp_hospitals` | 30,273 | National Hospital Directory, National Health Portal (Govt. of India, data.gov.in) | Diversion to the nearest emergency-capable hospitals, radar map, fuzzy search (`pg_trgm`) |
| `india_pincodes` | 16,868 | India Post pincode list with latitude/longitude | Ambulance crews report their position by pincode; places directory hospitals that have no coordinates |
| `historical_discharges` | 45,659 | Hospital Inpatient Discharges (SPARCS De-Identified) 2021, New York State Department of Health: a random sample of up to 1,500 real stays per condition from 2,098,967 | Real length of stay, outcomes and resource intensity behind cost estimates and predicted discharge times |

- `dataset_sources` records the publisher, URL, licence, row counts and SHA-256 of every raw file.
- `mv_condition_benchmarks` (materialized view) computes `percentile_cont()` length-of-stay percentiles, mortality and cost intensity per condition and severity.
- The directory is incomplete (many phone numbers and bed counts are missing; 35% of rows have exact coordinates, the rest use their pincode centroid). The app says so instead of hiding it.
- No public dataset gives live bed availability for Indian hospitals. That gap is the problem the Golden Hour desk is built around: the hospital publishes its own live state with `LISTEN/NOTIFY`.
- SPARCS is US data. It is used only for *how long* stays last and *how resource-heavy* a condition is relative to an average stay. Every rupee figure comes from this hospital's own ward tariff.

---

## ✨ Novelty Features

### 1. Golden Hour Desk: ambulance pre-booking (`/ambulance`)
- A 108 / private crew calls ahead with position (pincode), vitals, ESI level and likely condition.
- `fn_reserve_bed_for_alert()` picks the best free bed (ward type, ventilator, department) and inserts a `bed_holds` row whose `hold_window` is a `tsrange` from now to ETA + 20 minutes.
- **No cron job**: a hold is only live while `hold_window @> LOCALTIMESTAMP`, so it expires by itself. `fn_release_expired_holds()` tidies up lazily.
- `ex_no_double_bed_hold` (GiST exclusion, `WHERE status = 'Active'`) stops two ambulances being promised the same bed; `trg_admission_hold_guard` stops a walk-in being admitted into a held bed.
- On arrival `fn_admit_from_alert()` converts the hold into an admission in one transaction.
- If nothing fits, `fn_nearest_er_hospitals()` (bounding box + haversine over the national directory) lists diversion options, plus our beds most likely to free up soon.
- Every change is pushed to every open screen with PostgreSQL `LISTEN/NOTIFY` → Server-Sent Events (`/api/live`). Payloads never contain patient names.

### 2. Upfront cost estimate (admission desk, step 6)
- `fn_estimate_admission_cost(condition, severity, ward, scheme, cover)` returns low / typical / high / worst-case bills from the real P25 / P50 / P75 / P90 length of stay, priced at our tariff: `days × daily tariff × (1 + intensity index)`.
- Applies PM-JAY, Tamil Nadu CMCHIS or private cover and shows what the family pays.
- Saved in `cost_estimates` with who it was explained to; `v_estimate_accuracy` compares it with the final bill at discharge (within / above / below range).
- Bed cards show "likely free in …" from the real median stay for the patient's condition.

### 3. Role-based privacy enforced by PostgreSQL (`/privacy`)
- Every API request runs in one transaction with `SET LOCAL ROLE mr_doctor | mr_nurse | mr_billing | mr_admin` and `app.staff_id / app.staff_role / app.doctor_id / app.access_mode` settings (`asStaff()` in `lib/db.ts`).
- **Column grants**: billing staff cannot read `admissions.admission_diagnosis` or `triage_priority`. **Table grants**: doctors and nurses cannot read or write `billing`, so a discharge they attempt is rolled back.
- **Row-level security**: restricted records (medico-legal cases, VIPs, sensitive diagnoses) are visible only to the treating doctor, admins, billing and break-glass sessions (`fn_can_see_patient()`, policies on `patients`, `admissions`, `cost_estimates`, `login_audit`). Nurses cannot create restricted records.
- Integrity checks (holds, double booking) are `SECURITY DEFINER`, so they still see every row.
- The Privacy Lens runs the same SQL as six different people and shows the live privilege matrix and `pg_policies`.

### 4. Tamper-evident audit chain (`/integrity`)
- Triggers append every change to patients, admissions, bills, bed status, ambulance alerts, holds, estimates and logins to `audit_chain`.
- Each row stores `prev_hash` and `row_hash = SHA-256(prev_hash | seq | time | staff | role | table | op | old | new)` (`pgcrypto digest()`); an advisory lock keeps the chain from forking.
- `audit_chain` refuses `UPDATE`, `DELETE` and `TRUNCATE`, even for its owner; only `mr_admin` can read it.
- `fn_verify_audit_chain()` (any role) re-hashes every row and reports the first broken seal or link. Discharge receipts print a seal (`#seq · hash`) that anyone can check with `fn_check_seal()`.
- **Tamper drill** (admins): simulates a rogue DBA cutting a sealed bill to 40%, shows the detection, then restores the original.

---

## 🔌 REST API Endpoints

All endpoints use parameterized queries (`$1, $2`) via `lib/db.ts`. Data endpoints return `401` without a valid staff session and run as the staff member's PostgreSQL role; anything the database refuses comes back as `403` with SQLSTATE `42501`.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/stats` | High-level clinical dashboard metric counts |
| `GET` | `/api/beds` | Bed inventory with active admission & department joins (`?dept_id=&status=&ward_type=&search=`) |
| `PATCH` | `/api/beds/[id]` | Update bed operational status (e.g. Sanitizing -> Available) |
| `GET` | `/api/departments` | Department listings and bed capacity counts |
| `GET` | `/api/doctors` | Doctor directory (`?on_duty=true`) |
| `GET` | `/api/patients` | Patient directory and active admission check (`?q=`) |
| `POST` | `/api/patients` | Rapid emergency patient intake registration |
| `GET` | `/api/admissions` | Admissions list (`?status=Admitted&q=`) |
| `POST` | `/api/admissions` | Atomic admission creation with `ex_no_double_bed_booking` conflict detection |
| `GET` | `/api/billing/active` | Active inpatients with calculated stay days and tariff estimates |
| `POST` | `/api/billing/discharge` | Atomic discharge, bed release, and billing invoice generation |
| `GET` | `/api/billing/invoices` | Past and settled billing invoices |
| `GET` | `/api/analytics` | Departmental capacity, occupancy %, and revenue SQL aggregates |
| `POST` | `/api/auth/login` | Badge + PIN sign-in via `fn_authenticate_staff()` (lock-out, audit) |
| `POST` | `/api/auth/break-glass` | 15-minute emergency session with a recorded reason |
| `GET` | `/api/auth/me` | Current staff session |
| `POST` | `/api/auth/logout` | Revoke the session and clear the cookie |
| `GET` / `POST` | `/api/ambulance` | Inbound pre-alerts, nearby ER hospitals / record a pre-alert and hold a bed |
| `GET` / `PATCH` | `/api/ambulance/[id]` | Diversion options / `reserve`, `arrive`, `divert`, `cancel` |
| `GET` | `/api/live` | Server-Sent Events fed by PostgreSQL `LISTEN mediresource_live` |
| `GET` | `/api/pincodes?q=` | India Post pincode search |
| `GET` | `/api/hospitals?q=` | Fuzzy search of the National Hospital Directory (`pg_trgm`) |
| `GET` | `/api/estimates/conditions` | Condition catalogue and insurance schemes |
| `GET` | `/api/estimates/preview` | Live cost estimate + real length-of-stay distribution |
| `GET` | `/api/privacy` | Privacy Lens: your DB identity, privilege matrix, policies, six-viewer comparison |
| `GET` | `/api/audit` | Chain verification (everyone) and sealed rows (admins) |
| `POST` | `/api/audit/seal` | Check a receipt seal |
| `POST` | `/api/audit/drill` | Tamper drill: `tamper` / `restore` (admins) |

---

## 🔒 Database Integrity & Safety Features

1. **Exclusion Constraint**: `ex_no_double_bed_booking EXCLUDE USING gist (bed_id WITH =, stay_duration_range WITH &&)` ensures that no two admissions can ever overlap on the same physical bed.
2. **Critical Care Equipment Check**: `chk_critical_infra` ensures all ICU and CCU beds must have `has_ventilator = true` and `has_oxygen_port = true`.
3. **Billing Stored Generated Columns**: `gross_amount` and `net_patient_payable` are computed automatically by PostgreSQL.
4. **Settled Timestamp Consistency**: `chk_settled_time` requires non-null `settled_at` only when `payment_status = 'Settled'`.
5. **SQL Injection Prevention**: 100% of queries use `$1, $2, ...` prepared statements.
6. **Credential Safety**: PINs exist only as bcrypt hashes (`pgcrypto`); session tokens exist only as SHA-256 hashes; break-glass sessions cannot exceed 15 minutes (`chk_break_glass_window`).
7. **Row-Level Security & Column Grants**: four PostgreSQL roles, 10 policies; restricted records and finance data are enforced by the database, not the UI.
8. **Timed Ambulance Holds**: `ex_no_double_bed_hold` exclusion constraint on `tsrange` windows plus `trg_admission_hold_guard`.
9. **Tamper-Evident Audit Chain**: SHA-256 hash chain, append-only triggers, verification and receipt seals.

### Try it in 5 minutes (viva script)
1. Sign in as `NUR-2001` → Golden Hour → **Highway crash** → *Record pre-alert*. A ventilator ICU bed turns blue on the 3D tower on every open screen.
2. Try to admit someone into that bed from the admission desk: PostgreSQL refuses (`ex_bed_held_for_ambulance`).
3. Sign in as `DOC-1002-TN`: ER-TRAUMA B-1 shows *Protected record*. Sign in as `DOC-1001-TN` (treating doctor): the name appears.
4. As `DOC-1001-TN`, admit a patient with a cost estimate; as `BIL-3001`, discharge them and see the estimate check and audit seal on the receipt.
5. As `ADM-0001` → Integrity Ledger → *Tamper with a sealed bill* → the chain turns red at that row → *Restore original*.

