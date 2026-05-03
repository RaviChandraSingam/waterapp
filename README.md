# WaterApp — Apartment Water Consumption Management System

A complete water consumption tracking, billing, and management system for an apartment complex with 5 blocks (240 flats). Includes a web dashboard, REST API, and a mobile app for on-site meter reading capture.

---

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Web App    │────▶│  Backend API │◀────│  Mobile App  │
│  React/Vite  │     │  Express.js  │     │  Expo/React  │
│  Firebase    │     │  Cloud Run   │     │  Native      │
│  Hosting     │     │  (GCP)       │     │              │
└──────────────┘     └──────┬───────┘     └──────────────┘
                            │
                     ┌──────▼───────┐
                     │  PostgreSQL  │
                     │  (Supabase)  │
                     └──────────────┘
```

**Production URLs**
- Web: `https://waterapp-prod-492407.web.app`
- API: Google Cloud Run (`water-backend`, region `us-central1`)

---

## Features

### Meter Reading Workflow
- **3 Readings Per Month** — Start (auto-populated), Mid-month, and End-of-month readings per flat
- **Auto-Populated Start Readings** — When a new monthly record is created, the previous month's closing (end) reading is automatically copied as the start reading for every flat. Only mid and end readings need to be captured manually.
- **Bulk or Single-Flat Entry** — Enter readings for all flats in a block at once, or select an individual flat
- **Previous Month Reference** — Last month's closing reading shown alongside every entry field for reference
- **Status-Based Locking** — Readings can be added or modified in any status (Draft, Captured, Reviewed) except **Final**. Only once a record reaches Final status are all changes locked.
- **Anomaly Warnings** — Alerts when a reading is below the previous one or spikes more than the configured threshold (default 50%)

### Billing
- **3-Slab Billing** — Configurable slab limits and multipliers (Slab 1: base rate, Slab 2: 1.5×, Slab 3: 2×)
- **Dynamic Cost Items** — Monthly expenses (salt, electricity bills, tanker costs) tracked per period
- **Configurable Tanker Costs** — Regular and Kaveri tanker unit costs can vary per month, defaulting from the previous month's value
- **Billing CSV Export** — Download billing summaries as CSV

### Workflow & Approvals
- **Status Workflow** — Draft → Captured → Reviewed → Final, with role-based transitions
- **Role-Based Transitions**:
  - Plumber: Draft → Captured
  - Accountant: Captured ↔ Reviewed
  - Water Committee: any transition including Reviewed → Final

### Excel Integration
- **Excel Export** — Generates spreadsheets matching the original Excel format for any monthly record
- **Excel Upload** — Import meter readings from filled-in `.xlsx` files. Case-insensitive block/source matching. Supports all 5 blocks and tanker entries. Dynamic cost item scanning.

### Analytics & Dashboard
- **Dashboard** — Consumption trends, block-wise stats, billing summaries, monthly comparisons
- **Analytics Page** — Detailed consumption and billing analytics across periods

### AI Chatbot
- **Gemini-Powered Assistant** — Ask questions about water consumption, billing history, and anomalies in natural language. Powered by Google Gemini 1.5 Flash. Accessible via the chat icon in the web app.

### User Management
- **Role Assignment** — Create users with roles: Guest, Plumber, Accountant, Water Committee
- **Delegated User Management** — Users with `can_manage_users` permission can add new users and edit user names without needing full superadmin access
- **Edit User Name** — Users with manage permission can update the display name of any user
- **Password Management** — Users can change their own password; superadmin can reset any user's password
- **Permissions** — Superadmin can toggle `can_manage_users` and `is_superadmin` flags per user

### Pending Items
- **Pending Items Tracker** — Track outstanding action items (e.g., missing readings, unresolved warnings) with status tracking

### Audit Trail
- All reading captures and modifications are logged with old/new values, user, and timestamp
- Accountant and Water Committee can view the full audit log for any monthly record

### Configuration
- **Billing Config** — Adjust slab limits, cost multipliers, and warning thresholds without code changes

---

## Role Reference

| Role | Capabilities |
|------|-------------|
| **Guest** | View-only access to records, readings, and billing |
| **Plumber** | Capture meter readings (web + mobile); transition Draft → Captured |
| **Accountant** | Capture/modify readings; review billing; export reports; manage cost items; Captured ↔ Reviewed |
| **Water Committee** | Full access: all of the above + finalize records, configure system, manage water sources |
| **Superadmin** (flag) | Manage users, reset passwords, assign permissions |
| **can_manage_users** (flag) | Add users and edit user names (delegated, without full superadmin) |

---

## Project Structure

```
waterapp/
├── cloudbuild.yaml             # Google Cloud Build CI/CD pipeline
├── docker-compose.yml          # Local development orchestration
├── firebase.json               # Firebase Hosting config
├── waterapp-fixed.sql          # Canonical DB restore (local Docker)
├── waterapp-supabase-v2.sql    # Canonical DB restore (Supabase)
├── backend/                    # Node.js + Express API
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── index.js            # Server entry point
│       ├── cache.js            # In-memory caching layer
│       ├── db/
│       │   ├── index.js        # PostgreSQL connection pool
│       │   ├── init.sql        # Database schema
│       │   └── seed.sql        # Reference seed template
│       ├── helpers/
│       │   └── recalculate.js  # Billing recalculation logic
│       ├── middleware/
│       │   └── auth.js         # JWT authentication & role authorization
│       └── routes/
│           ├── auth.js         # Login, user management, name editing
│           ├── blocks.js       # Blocks and flats
│           ├── readings.js     # Meter reading capture & verification
│           ├── monthlyRecords.js  # Monthly periods, auto-populate start readings
│           ├── commonAreas.js  # Common area readings
│           ├── billing.js      # Billing reports
│           ├── analytics.js    # Analytics endpoints
│           ├── config.js       # System configuration
│           ├── dashboard.js    # Dashboard stats
│           ├── export.js       # Excel export
│           ├── upload.js       # Excel file upload/import
│           ├── chat.js         # AI chatbot (Gemini)
│           └── pendingItems.js # Pending items tracker
├── web/                        # React + Vite frontend
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── App.jsx             # Main app with auth, routing, sidebar
│       ├── components/
│       │   └── ChatBot.jsx     # AI chatbot UI component
│       ├── services/
│       │   └── api.js          # API client for all endpoints
│       └── pages/
│           ├── LoginPage.jsx
│           ├── DashboardPage.jsx
│           ├── MonthlyRecordsPage.jsx
│           ├── MonthlyRecordDetailPage.jsx
│           ├── ReadingsCapturePage.jsx
│           ├── BillingPage.jsx
│           ├── ConfigPage.jsx
│           ├── UsersPage.jsx
│           └── PendingItemsPage.jsx
└── mobile/                     # Expo / React Native app
    ├── App.js
    ├── app.json
    └── src/
        ├── services/api.js
        └── screens/
            ├── LoginScreen.js
            ├── HomeScreen.js
            ├── SelectBlockScreen.js
            ├── CaptureReadingsScreen.js
            └── SettingsScreen.js
```

---

## Quick Start (Local Dev with Docker)

### Prerequisites

- **Docker Desktop** — [Download](https://www.docker.com/products/docker-desktop/)
- **Node.js 20+** — [Download](https://nodejs.org/)

### 1. Start the database

```bash
cd /Users/Ravi/code/waterapp
docker compose up -d db
```

### 2. Restore all data (first-time setup only)

```bash
psql "postgresql://waterapp:waterapp_secret@localhost:5432/waterapp" \
  -f waterapp-fixed.sql
```

> **Important:** Never run `seed.sql` after restoring — it generates new random UUIDs that break FK references.

### 3. Start all services

```bash
docker compose up -d
```

| Service | Port | Purpose |
|---------|------|---------|
| `db` | 5432 | PostgreSQL database |
| `backend` | 3000 | Express API server |
| `web` | 5173 | Vite dev server (React) |

### 4. Open the web app

**http://localhost:5173**

### 5. Default users

| Username | Role | Access |
|----------|------|--------|
| `plumber1` | Plumber | Capture readings |
| `accountant1` | Accountant | Capture/modify, review, export, billing |
| `admin1` | Water Committee | Full admin |

---

## Deployment (Google Cloud)

### Services

| Component | Service | Details |
|-----------|---------|---------|
| Backend | Google Cloud Run | `water-backend`, region `us-central1` |
| Frontend | Firebase Hosting | `waterapp-prod-492407.web.app` |
| Database | Supabase | Managed PostgreSQL |
| Secrets | GCP Secret Manager | `DATABASE_URL`, `JWT_SECRET`, `GEMINI_API_KEY` |
| Container Registry | Artifact Registry | `us-central1-docker.pkg.dev/waterapp-prod-492407/app-repo/water-backend` |

### Deploy

```bash
cd /Users/Ravi/code/waterapp
gcloud builds submit --config=cloudbuild.yaml --project=waterapp-prod-492407
```

The pipeline: builds + pushes the backend Docker image to Artifact Registry → deploys to Cloud Run → builds the React frontend → deploys to Firebase Hosting.

---

## Useful Commands

```bash
# Start all services
docker compose up -d

# Stop all services
docker compose down

# View logs (live)
docker compose logs -f

# Rebuild after Dockerfile or package.json changes
docker compose up -d --build

# Connect to the database directly
docker exec -it waterapp-db psql -U waterapp -d waterapp

# Restore DB from canonical dump (wipes existing data)
psql "postgresql://waterapp:waterapp_secret@localhost:5432/waterapp" -f waterapp-fixed.sql
```

---

## Database Schema

| Table | Description |
|-------|-------------|
| `users` | System users with roles and permission flags |
| `blocks` | 5 apartment blocks (A–E) |
| `flats` | 240 individual flats |
| `common_areas` | Club house, gardens, etc. |
| `water_sources` | Borewells, tankers |
| `monthly_records` | One per billing period (year + month) |
| `cost_items` | Monthly expenses (salt, e-bill, etc.) |
| `water_source_readings` | Borewell/tanker meter readings per period |
| `meter_readings` | Individual flat meter values (up to 3 per month) |
| `common_area_readings` | Common area meter values |
| `flat_billing` | Calculated slab-wise bill per flat |
| `billing_config` | Slab limits, multipliers, warning thresholds |
| `audit_log` | All reading modifications with old/new values |
| `pending_items` | Action items and follow-ups |

---

## Billing Formula

```
Cost per litre = (Salt + E-Bill + Tanker costs) ÷ Total water input (litres)

Slab 1:  0 – 15,000 L       → cost_per_litre × 1.0
Slab 2:  15,001 – 20,000 L  → cost_per_litre × 1.5
Slab 3:  Above 20,000 L     → cost_per_litre × 2.0
```

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Database (local dev) | PostgreSQL 16 via Docker |
| Database (production) | Supabase (managed PostgreSQL) |
| Backend | Node.js 20, Express.js |
| Web Frontend | React 18, Vite 5, React Router 6 |
| Mobile App | Expo SDK 52, React Native |
| Auth | JWT (24h expiry), bcrypt |
| Excel | ExcelJS, Multer (file upload) |
| AI Chatbot | Google Gemini 1.5 Flash |
| Containerization | Docker Compose (local), Google Cloud Run (production) |
| Frontend Hosting | Firebase Hosting |
| CI/CD | Google Cloud Build |
| Secrets | GCP Secret Manager |

---

## Mobile App Setup

The mobile app is built with **Expo** (React Native). Primarily used by the plumber to capture meter readings on-site.

### Prerequisites

- Node.js 20+ on your Mac
- **Expo Go** app on your Android phone — [Google Play](https://play.google.com/store/apps/details?id=host.exp.exponent)

### Run on Android phone (same Wi-Fi)

```bash
# Find your Mac's local IP
ipconfig getifaddr en0

cd /Users/Ravi/code/waterapp/mobile
npm install
npx expo start
```

Scan the QR code with Expo Go. In the app: Login → Settings → set Server URL to `http://<YOUR_MAC_IP>:3000`.

### Run in iOS Simulator

```bash
cd /Users/Ravi/code/waterapp/mobile
npm install
npx expo start --ios
```

### Build a standalone APK

```bash
npm install -g eas-cli
eas login
cd /Users/Ravi/code/waterapp/mobile
eas build --platform android --profile preview
```
