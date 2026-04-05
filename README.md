# WaterApp — Apartment Water Consumption Management System

A complete water consumption tracking, billing, and management system for an apartment complex with 5 blocks (240 flats). Includes a web dashboard, REST API, and a mobile app for on-site meter reading capture.

---

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Web App    │────▶│  Backend API │◀────│  Mobile App  │
│  React/Vite  │     │  Express.js  │     │  Expo/React  │
│  Port 5173   │     │  Port 3000   │     │  Native      │
└──────────────┘     └──────┬───────┘     └──────────────┘
                            │
                     ┌──────▼───────┐
                     │  PostgreSQL  │
                     │  Port 5432   │
                     └──────────────┘
```

## Features

- **Meter Reading Capture** — Bulk or single-flat entry for 240 flats across 5 blocks (A–E). Readings increment in steps of 1. Last month's closing reading shown for reference.
- **Audit Trail** — All reading captures and modifications are logged with old/new values, user, and timestamp
- **Status-Based Locking** — Readings cannot be added or modified once a record is in Reviewed or Final status
- **3-Slab Billing** — Configurable slab limits and multipliers (Slab 1: base rate, Slab 2: 1.5×, Slab 3: 2×)
- **Anomaly Warnings** — Alerts when a reading is below the previous one or has a 50%+ spike
- **Workflow** — Draft → Captured → Reviewed → Final, with role-based transitions
- **Excel Export** — Generates spreadsheets matching the original Excel format
- **Excel Upload** — Import meter readings from filled-in Excel files for any month (same format as original sheets)
- **Configurable Tanker Costs** — Regular and Kaveri tanker costs can vary per month, defaulting from the previous month's value
- **Dashboard** — Consumption trends, block-wise stats, billing summaries
- **Role-Based Access**:
  - **Plumber** — Capture meter readings on-site (mobile app)
  - **Accountant** — Capture/modify readings, review, export reports, view billing
  - **Water Committee** — Full admin: sign-off billing, manage users, configure system

## Project Structure

```
waterapp/
├── docker-compose.yml          # Orchestrates all services (local dev)
├── waterapp-fixed.sql          # Canonical DB restore file (Docker)
├── waterapp-supabase-v2.sql    # Canonical DB restore file (Supabase)
├── backend/                    # Node.js + Express API
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── index.js            # Server entry point
│       ├── db/
│       │   ├── index.js        # PostgreSQL connection pool
│       │   ├── init.sql        # Database schema (tables, indexes) — auto-run by Docker
│       │   └── seed.sql        # Reference seed template (NOT auto-run — data comes from waterapp-fixed.sql)
│       ├── middleware/
│       │   └── auth.js         # JWT authentication & role authorization
│       ├── routes/
│       │   ├── auth.js         # Login, user management
│       │   ├── blocks.js       # Blocks and flats
│       │   ├── readings.js     # Meter reading capture & verification
│       │   ├── monthlyRecords.js  # Monthly periods, billing calculation
│       │   ├── commonAreas.js  # Common area readings
│       │   ├── billing.js      # Billing reports
│       │   ├── config.js       # System configuration
│       │   ├── dashboard.js    # Dashboard stats
│       │   ├── export.js       # Excel export
│       │   └── upload.js       # Excel file upload/import
│       └── scripts/
│           └── importExcel.js  # One-time import from existing Excel files
├── web/                        # React + Vite frontend
│   ├── Dockerfile
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   └── src/
│       ├── main.jsx
│       ├── index.css
│       ├── App.jsx             # Main app with auth, routing, sidebar
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
│           └── UsersPage.jsx
├── mobile/                     # Expo / React Native app
│   ├── App.js                  # Entry point with auth & navigation
│   ├── app.json                # Expo configuration
│   ├── babel.config.js
│   ├── package.json
│   └── src/
│       ├── services/
│       │   └── api.js          # API client for mobile
│       └── screens/
│           ├── LoginScreen.js
│           ├── HomeScreen.js
│           ├── SelectBlockScreen.js
│           ├── CaptureReadingsScreen.js
│           └── SettingsScreen.js
└── *.xlsx                      # Original Excel data files (Nov 2025 – Feb 2026)
```

---

## Quick Start (Web + API)

### Prerequisites

- **Docker Desktop** — [Download](https://www.docker.com/products/docker-desktop/)
- **Node.js 20+** — [Download](https://nodejs.org/)

### 1. Start the database

```bash
cd /Users/Ravi/code/waterapp
docker compose up -d db
```

### 2. Restore all data (first-time setup only)

The database starts empty (just schema from `init.sql`). Restore the full dataset:

```bash
psql "postgresql://waterapp:waterapp_secret@localhost:5432/waterapp" \
  -f waterapp-fixed.sql
```

This loads all historical data (5 months of readings, 240 flats, billing records) with FK-consistent UUIDs.

> **Important:** Never run `seed.sql` after restoring — it generates new random UUIDs that break FK references in the billing data.

### 3. Start all services

```bash
docker compose up -d
```

This starts 3 containers:
| Service | Container | Port | Purpose |
|---------|-----------|------|---------|
| `db` | waterapp-db | 5432 | PostgreSQL database |
| `backend` | waterapp-backend | 3000 | Express API server |
| `web` | waterapp-web | 5173 | Vite dev server (React) |

### 2. Verify services are running

```bash
# Check all containers are up
docker compose ps

# Check backend logs
docker compose logs backend

# Check web logs
docker compose logs web
```

### 4. Open the web app

Open your browser and go to: **http://localhost:5173**

### 5. Log in

| Username | Password | Role | Access |
|----------|----------|------|--------|
| `plumber1` | `` | Plumber | Capture readings |
| `accountant1` | `` | Accountant | Capture/modify readings, review, export, billing |
| `admin1` | `` | Water Committee | Full admin |

### 6. What to check in the web app

1. **Login** — Sign in as `admin1` for full access
2. **Dashboard** — See overall stats, consumption trends, block-wise summaries
3. **Monthly Records** — View 4 imported months (Nov 2025 – Feb 2026). Click any record to see:
   - **Overview** tab — Period dates, status, cost items, water sources
   - **Meter Readings** tab — All flat readings by block
   - **Common Areas** tab — Club house, gardens, etc.
   - **Billing** tab — Slab-wise cost breakdown per flat
   - **Costs & Sources** tab — Water input, expense items, editable tanker costs per month
4. **Capture Readings** — Select a record, block, and sequence. Toggle between bulk (all flats) and single-flat entry mode. Last month's closing reading shown as read-only reference. Accountant and Water Committee can view the audit log of all changes.
5. **Billing** — Filter by month and block to see detailed cost reports
6. **Configuration** (admin only) — View/edit slab limits, multipliers, warning thresholds
7. **Users** (admin only) — Create new users with role assignment
8. **Export** — Click "Download Excel" on any monthly record for a spreadsheet
9. **Upload** — Click "Upload Excel" on any draft/captured record to import readings from a filled-in `.xlsx` file

---

## Mobile App Setup

The mobile app is built with **Expo** (React Native). It's primarily for the plumber to capture meter readings on-site.

### Prerequisites

- **Node.js 20+** installed on your Mac
- **Expo Go** app installed on your Android phone — [Google Play Store](https://play.google.com/store/apps/details?id=host.exp.exponent)

### Option A: Run in iOS Simulator (Mac)

#### 1. Install Xcode

- Open **App Store** on your Mac and install **Xcode** (free)
- After installing, open Xcode once and accept the license agreement
- Install iOS Simulator:
  ```bash
  xcode-select --install
  sudo xcodebuild -license accept
  ```

#### 2. Install dependencies and start

```bash
cd /Users/Ravi/code/waterapp/mobile
npm install
npx expo start --ios
```

This will:
- Open the iOS Simulator automatically
- Build and install the WaterApp on the simulator
- The app shows a login screen

#### 3. Configure server URL

- In the app, log in with `plumber1` / ``
- Go to **Settings** (gear icon in top-right)
- Set the server URL to: `http://localhost:3000`
- Tap **Save URL**

### Option B: Run in Android Emulator (Mac)

#### 1. Install Android Studio

- Download from: https://developer.android.com/studio
- During setup, ensure these are installed:
  - Android SDK
  - Android SDK Platform
  - Android Virtual Device (AVD)
- Create an emulator:
  1. Open Android Studio → **More Actions** → **Virtual Device Manager**
  2. Click **Create Device** → Pick **Pixel 7** (or any phone) → **Next**
  3. Select a system image (e.g., API 34) → **Download** → **Next** → **Finish**
  4. Click the **Play ▶** button to start the emulator

#### 2. Start the app

```bash
cd /Users/Ravi/code/waterapp/mobile
npm install
npx expo start --android
```

#### 3. Configure server URL

- Log in, go to Settings
- Set server URL to: `http://10.0.2.2:3000` (Android emulator's alias for host machine)
- Tap **Save URL**

### Option C: Run on a Physical Android Phone (same Wi-Fi)

#### 1. Find your Mac's local IP

```bash
ipconfig getifaddr en0
```
Note the IP (e.g., `192.168.1.42`).

#### 2. Install and start

```bash
cd /Users/Ravi/code/waterapp/mobile
npm install
npx expo start
```

A QR code appears in the terminal.

#### 3. Connect from your phone

1. Open the **Expo Go** app on your Android phone
2. Tap **Scan QR Code** and scan the terminal QR code
3. The app will download and open on your phone

#### 4. Configure server URL

- Log in with `plumber1` / ``
- Go to **Settings**
- Set server URL to: `http://<YOUR_MAC_IP>:3000` (e.g., `http://192.168.1.42:3000`)
- Tap **Save URL**

> **Important**: Your phone and Mac must be on the **same Wi-Fi network**.

---

## Install as a Standalone APK on Android

To create an installable `.apk` file that doesn't require Expo Go:

### 1. Install EAS CLI

```bash
npm install -g eas-cli
```

### 2. Log in to Expo (create a free account at expo.dev if needed)

```bash
eas login
```

### 3. Configure the build

```bash
cd /Users/Ravi/code/waterapp/mobile
eas build:configure
```

### 4. Create a development build (APK)

```bash
eas build --platform android --profile preview
```

Add this to `mobile/eas.json` if it doesn't exist:
```json
{
  "build": {
    "preview": {
      "android": {
        "buildType": "apk"
      }
    },
    "production": {
      "android": {
        "buildType": "app-bundle"
      }
    }
  }
}
```

Then run:
```bash
eas build --platform android --profile preview
```

### 5. Install on your phone

- The build runs on Expo's cloud servers (takes ~10 minutes)
- When done, you get a download URL for the `.apk` file
- Download the APK on your Android phone
- Open it and tap **Install** (you may need to allow "Install from unknown sources" in Android settings)
- The app is now installed — no Expo Go needed

### 6. Update the server URL

- Open the installed app
- Log in → Settings → set the server URL to your backend's address
- The backend must be accessible from your phone's network

---

## Useful Commands

```bash
# Start all services
docker compose up -d

# Stop all services
docker compose down

# View logs (live)
docker compose logs -f

# View logs for a specific service
docker compose logs -f backend

# Restart a service after code changes
docker compose restart backend

# Rebuild after Dockerfile or package.json changes
docker compose up -d --build

# Connect to the database directly
docker exec -it waterapp-db psql -U waterapp -d waterapp

# Check flat count per block
docker exec -it waterapp-db psql -U waterapp -d waterapp -c "SELECT b.display_name, COUNT(f.id) FROM blocks b JOIN flats f ON f.block_id = b.id GROUP BY b.display_name ORDER BY b.display_name;"

# Re-run the Excel data import (idempotent — uses upserts)
cd backend && node src/scripts/importExcel.js

# Restore DB from canonical dump (wipes existing data)
psql "postgresql://waterapp:waterapp_secret@localhost:5432/waterapp" -f waterapp-fixed.sql
```

## Database

| Table | Description |
|-------|-------------|
| `users` | System users with roles |
| `blocks` | 5 apartment blocks (A–E) |
| `flats` | 240 individual flats |
| `common_areas` | Club house, gardens, etc. |
| `water_sources` | Borewells, tankers |
| `monthly_records` | One per month — the billing period |
| `cost_items` | Salt, E-Bills per period |
| `water_source_readings` | Borewell/tanker readings per period (with optional per-month cost_per_unit) |
| `meter_readings` | Individual flat meter values (up to 3 per month) |
| `common_area_readings` | Common area meter values |
| `flat_billing` | Calculated slab-wise bills per flat |
| `billing_config` | Slab limits, multipliers, thresholds |
| `audit_log` | Track all reading modifications |

## Billing Formula

```
Cost per litre = (Salt + E-Bill + Tanker costs) ÷ Total water input (litres)

Slab 1:  0 – 15,000 L     → cost_per_litre × 1.0
Slab 2:  15,001 – 20,000 L → cost_per_litre × 1.5
Slab 3:  Above 20,000 L    → cost_per_litre × 2.0
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Database (local dev) | PostgreSQL 16 via Docker |
| Database (production) | Supabase (managed PostgreSQL) |
| Backend | Node.js 20, Express.js |
| Web Frontend | React 18, Vite 5, React Router 6 |
| Mobile App | Expo SDK 52, React Native |
| Auth | JWT (24h expiry), bcrypt |
| Excel | ExcelJS, Multer (upload) |
| Containerization | Docker Compose (local), Fly.io (production) |
