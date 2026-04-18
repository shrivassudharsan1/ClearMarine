# ClearMarine — AI-Powered Ocean Waste Coordination System

Real-time ocean debris tracking, ML drift forecasting, and multi-agency cleanup coordination. Built for DataHacks 2026.

---

## The Three Interfaces

| Route | Who uses it | What it does |
|---|---|---|
| `/report` | Anyone on a boat or beach | Photo + GPS debris report — Gemini Vision analyzes type, density, volume |
| `/dashboard` | Coastguard / EPA coordinators | Live Leaflet map with debris clusters, animated drift paths, crew dispatch |
| `/vessel/:id` | Cleanup crew on vessel | Status management, supply inventory with PRIORITY alerts, assignment brief |

---

## How It Works

```
Public Reporter (/report)
    │  photo + GPS
    ▼
Gemini Vision Analysis → Supabase debris_sightings
    │
    ▼
Drift Prediction Engine → Supabase drift_predictions
    │  (ocean current simulation, 24/48/72h paths)
    ▼
Dashboard (/dashboard) ← real-time Supabase subscriptions
    │
    ├── AI Crew Agent → recommends optimal intercept vessel
    ├── Assign vessel → generates crew brief via Gemini
    ├── Jurisdiction Handoff → Local Coastguard → EPA (with Gemini brief)
    └── Vessel Station (/vessel/:id) — fuel, supplies, mark intercepted
```

---

## Prerequisites

Install **Node.js** first — [nodejs.org](https://nodejs.org) (LTS version).

Verify:
```bash
node -v   # v20+
npm -v    # v10+
```

---

## Getting Started

### 1. Clone

```bash
git clone -b initial-implementation https://github.com/shrivassudharsan1/ClearMarine.git
cd ClearMarine
npm install
```

### 2. Set up Supabase

1. Create a free project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** → paste and run the full contents of `supabase_schema.sql`
   - Creates all tables, disables RLS, enables Realtime, seeds 5 vessels + 12 zone supplies + 2 demo sightings
3. Go to **Project Settings → API** → copy your URL and anon key

### 3. Environment variables

```bash
cp .env.example .env
```

Fill in `.env`:
```
REACT_APP_SUPABASE_URL=https://your-project.supabase.co
REACT_APP_SUPABASE_ANON_KEY=your-anon-key
REACT_APP_GEMINI_API_KEY=your-gemini-key
```

Get a Gemini key at [aistudio.google.com](https://aistudio.google.com). Use `gemini-2.5-flash` — it supports vision (photo analysis) and is free tier eligible.

### 4. Run

```bash
npm start
```

---

## Database Schema

```
debris_sightings  — id, reporter_name, photo_url, latitude, longitude,
                    debris_type, density_score, density_label, estimated_volume,
                    gemini_analysis, status, jurisdiction, handoff_status

vessels           — id, name, zone, agency, status, fuel_level, fuel_threshold,
                    capacity, current_lat, current_lon

drift_predictions — id, sighting_id, lat_24h/lon_24h, lat_48h/lon_48h,
                    lat_72h/lon_72h, current_speed, current_bearing

supplies          — id, name, zone, quantity, low_threshold

assignments       — id, sighting_id, vessel_id, interception_lat/lon,
                    interception_hours, status, gemini_brief
```

---

## Features Built

### Debris Reporting (`/report`)
- [x] Name / vessel ID entry
- [x] Camera photo upload (mobile: uses rear camera)
- [x] GPS auto-detection with manual lat/lon fallback
- [x] Voice notes via Web Speech API
- [x] Gemini Vision analysis — debris type, density score (1-10), volume estimate
- [x] Drift prediction computed on submit (24/48/72h positions)
- [x] Saves sighting + drift to Supabase; notifies dashboard in real time
- [x] Results screen shows drift path coordinates + back to start

### Coordination Dashboard (`/dashboard`)
- [x] Full-screen Leaflet map (OpenStreetMap tiles)
- [x] Debris markers color-coded by density (green → red)
- [x] Animated drift path polylines: yellow (24h) → orange (48h) → red (72h)
- [x] Vessel markers on map with popup details
- [x] Real-time updates via Supabase subscriptions
- [x] AI Crew Agent — structured suggestions with action buttons (Assign, Accept, Reorder, Clear)
- [x] Crew assignment modal — picks vessel, computes optimal interception point, generates Gemini crew brief
- [x] Jurisdiction handoff (Local Coastguard → EPA → NOAA → Navy) with Gemini brief
- [x] Incoming handoff panel with Accept button
- [x] Sightings / Vessels / Supplies tab panel in sidebar
- [x] Mark cluster cleared

### Vessel Station (`/vessel/:id`)
- [x] Status switcher (available / deployed / returning / maintenance)
- [x] Fuel level bar with +/− controls
- [x] Active assignment panel with crew brief and interception coordinates
- [x] "Mark Intercepted" button
- [x] Zone supply list with +/− quantity buttons
- [x] PRIORITY badge on low-stock supplies
- [x] All changes sync to dashboard in real time

---

## Future Implementations

### High Priority
- [ ] **Real NOAA current data** — replace drift simulation with live API calls to NOAA CO-OPS / RTOFS
- [ ] **Authentication** — crews vs. public reporters vs. agency coordinators
- [ ] **Push notifications** — alert coordinators when critical debris reported or handoff pending
- [ ] **Satellite imagery integration** — overlay MODIS/Sentinel ocean color data on map

### ML / AI
- [ ] **Trained drift model** — replace simplified gyre simulation with ML model trained on historical debris trajectory data (NOAA OSCAR currents)
- [ ] **Debris density ML** — train classifier on labeled ocean debris photos instead of relying solely on LLM vision
- [ ] **Predictive vessel routing** — optimize fleet dispatch across multiple simultaneous clusters
- [ ] **Historical pattern analysis** — identify recurring debris accumulation zones by season

### Operational
- [ ] **AIS vessel tracking** — pull real vessel positions from AIS API instead of static seed coordinates
- [ ] **Supply chain integration** — reorder triggers send to actual port supply systems
- [ ] **Multi-agency access control** — EPA sees only EPA-jurisdiction clusters, etc.
- [ ] **Offline PWA** — service worker for crews in low-connectivity open ocean areas
- [ ] **Export reports** — PDF incident report generation per cluster

### Map / UX
- [ ] **Animated drift particles** — show debris movement as animated dots rather than static lines
- [ ] **Heatmap overlay** — aggregate historical sighting density
- [ ] **Mapbox GL** — upgrade from Leaflet for 3D ocean depth visualization
- [ ] **Mobile-optimized dashboard** — current dashboard is desktop-first

---

## Demo Flow

1. Open `/report` on mobile or desktop
2. Upload a photo of debris (or any photo for demo) — tap the camera box
3. Allow GPS or enter coordinates manually (e.g. 34.05, -120.4)
4. Click **Submit** — Gemini Vision analyzes, drift computed, saved to DB
5. Open `/dashboard` — new debris marker appears on map with drift path
6. Click **Refresh** on AI Crew Agent — see crew recommendations
7. Click **Assign** on the sighting → select **Ocean Guardian I** → **Assign + Generate Brief**
8. View crew brief with interception coordinates
9. Open `/vessel/<ocean-guardian-id>` from Vessels tab — see assignment, fuel, supplies
10. Tap **−** on Collection Nets → PRIORITY badge fires on dashboard
11. Use **Handoff →** dropdown on a sighting to transfer to EPA jurisdiction

---

## Contributing

Built by Shrivas Sudharsan at DataHacks 2026. PRs welcome — see Future Implementations for what's next.
