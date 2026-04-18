# ClearMarine — AI-Powered Ocean Waste Coordination System

Real-time ocean debris tracking, drift forecasting (Spray glider + HYCOM + fallback), and fleet coordination. Built for **DataHacks 2026**.

Repository: [github.com/shrivassudharsan1/ClearMarine](https://github.com/shrivassudharsan1/ClearMarine) (branch `initial-implementation`).

---

## The Three Interfaces

| Route | Who uses it | What it does |
|-------|-------------|--------------|
| `/report` | Anyone on a boat or beach | Photo and/or notes + GPS — AI assesses debris; drift saved with sighting |
| `/dashboard` | ClearMarine ops / partner coordinators | Live map, drift paths, AI crew agent, assign vessels, handoffs |
| `/vessel/:id` | Cleanup crew on vessel | Status, fuel, supplies, assignment brief, mark intercepted |

---

## How It Works

```
Public Reporter (/report)
    │  photo + GPS + optional notes
    ▼
Groq (vision + text) → Supabase debris_sightings
    │
    ▼
Drift engine (predictDrift) → Supabase drift_predictions
    │  • Nearest Spray CORC glider profile (if ≤ ~120 km)
    │  • else NOAA HYCOM grid in Supabase (seed_currents.js)
    │  • else simple gyre fallback
    │  24h / 48h / 72h positions from speed + bearing + small wobble
    ▼
Dashboard (/dashboard) ← Supabase Realtime
    │
    ├── AI Crew Agent — names a vessel when assigning; handles no-available-hull case
    ├── Assign vessel → interception point + Groq crew brief
    ├── Partner handoff → ClearMarine Operations ↔ EPA (partner), Groq handoff brief
    └── Vessel station — fuel, supplies, intercepted
```

---

## Spray / CORC Glider Data (Drift)

Observed **depth-mean currents** from **Spray underwater gliders** (e.g. **CORC** — California Regional Ocean projects) inform drift when a sighting is near historical profiles. Dataset ecosystem: [Spray Data — Data Access](https://spraydata.ucsd.edu/data-access) (ERDDAP, NetCDF, project pages).

### What the app actually loads

- The browser does **not** read the raw `.nc` file.
- A **build step** turns `CORC.nc` into **`public/data/corc_glider_index.json`**:
  - Uses **`lat_uv`**, **`lon_uv`**, **`u_depth_mean`**, **`v_depth_mean`**, **`time_uv`** from the NetCDF.
  - **Subsamples** to **8,000** profiles (even spacing) so the JSON stays ~1–1.3 MB for the web app.
  - Each row includes precomputed **speed (knots)** and **bearing (°)** for drift.

### Rebuild the glider index

Requires Python **3** with **netcdf4** and **numpy**:

```bash
pip install -r scripts/requirements-glider.txt
```

Then either:

```bash
# From repo root (ClearMarine / clearer):
python3 scripts/build_corc_glider_json.py /full/path/to/CORC.nc
```

Or place/copy **`CORC.nc`** in one of these and run **without** arguments:

- `clearer/data/CORC.nc`
- **`../CORC.nc`** (parent folder of `clearer/`, e.g. hackathon folder)
- `clearer/CORC.nc`

```bash
cd clearer
python3 scripts/build_corc_glider_json.py
```

Or set **`CORC_NC`**:

```bash
export CORC_NC=/path/to/CORC.nc
python3 scripts/build_corc_glider_json.py
```

npm shortcut:

```bash
npm run build:glider-data
```

*(Runs the script with no args — needs `CORC.nc` in one of the default locations above.)*

### Git / large files

**`CORC.nc`** and **`*.nc`** are **gitignored**. Only **`public/data/corc_glider_index.json`** is committed so clones stay small. Teammates regenerate JSON locally if they refresh from a new NetCDF.

### Runtime behavior

1. **`getNearestGliderCurrent(lat, lon)`** — loads the JSON once, finds nearest profile (spatial buckets + Haversine).
2. If distance **≤ `max_km_glider_priority`** (default **120 km** in JSON), drift uses **Spray glider CORC** speed/bearing.
3. Otherwise **HYCOM** from **`ocean_currents`** (if seeded).
4. Otherwise **gyre fallback**.

On **`/report`** success screen, **“Drift driver”** is highlighted when the source is **Spray**.

---

## Prerequisites

- **Node.js** [nodejs.org](https://nodejs.org) (LTS, e.g. v20+)
- **Supabase** project (free tier OK)
- **Groq API key** [console.groq.com](https://console.groq.com) for LLM + vision in the browser

```bash
node -v
npm -v
```

Optional (only to rebuild glider JSON): Python 3 + `scripts/requirements-glider.txt`.

---

## Getting Started

### 1. Clone

```bash
git clone -b initial-implementation https://github.com/shrivassudharsan1/ClearMarine.git
cd ClearMarine
npm install
```

### 2. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor** → run all of **`supabase_schema.sql`** (tables, seeds, Realtime publication).
3. **Project Settings → API** → copy URL and anon key.

### 3. HYCOM-style grid (optional but recommended)

From `clearer/` with `.env` filled:

```bash
node scripts/seed_currents.js
```

Populates **`ocean_currents`** for drift when no nearby glider profile applies.

### 4. Environment variables

```bash
cp .env.example .env
```

Fill in:

```
REACT_APP_SUPABASE_URL=https://your-project.supabase.co
REACT_APP_SUPABASE_ANON_KEY=your-anon-key
REACT_APP_GROQ_API_KEY=your-groq-key
```

### 5. Run

```bash
npm start
```

Production build:

```bash
npm run build
```

---

## Coordination Model (Single Product)

- **ClearMarine Operations** — default ops desk; new public reports use this jurisdiction.
- **EPA (partner)** — second queue in the **same app** (role selector). Handoffs are **partner lanes**, not a separate product.
- Incoming handoffs only show for the selected role when **`handoff_status = pending`**, **`jurisdiction`** matches you, and **`source_jurisdiction`** is not you (so you don’t see your own outgoing handoff as “incoming”).

---

## Notable Features (Current Build)

### Reporting (`/report`)

- Photo and/or text notes; GPS auto or manual.
- **Groq** JSON assessment: type, density, volume; conservative when detail is thin; **`needs_more_info`** triggers **confirm to submit anyway** (not a hard block).
- Heuristic boosts structured notes (e.g. `size:`, `material:`, `amount:`).
- Drift uses glider → HYCOM → fallback stack; result shows **drift driver** line.

### Dashboard (`/dashboard`)

- Leaflet map; hover/click coordinates; **fly-to** sighting when selecting list or marker.
- Drift polylines **clipped at modeled shore approach** (Pacific coast heuristic); **⚑** only when track leaves open ocean toward coast — path not drawn inland.
- **AI Crew Agent**: parses **JSON array** suggestions; auto-refresh after data loads / Realtime (debounced); suggests **named vessel** when assigning; if **no available hulls**, suggests non-assign actions.
- Assign / modal disabled when no **`available`** vessels; header shows ready count.
- Supplies low-stock alerts; mark cleared; interception brief modal.

### AI stack (`src/lib/gemini.js`)

- **Groq** models for vision (photo debris), text analysis, crew suggestions, assignment and handoff briefs.
- Crew suggestions include **pending handoff** IDs when relevant.

### Data files

| Path | Role |
|------|------|
| `public/data/corc_glider_index.json` | Subset of CORC for browser drift |
| `scripts/build_corc_glider_json.py` | Regenerate JSON from `CORC.nc` |
| `scripts/requirements-glider.txt` | Python deps for build script |

---

## Database Schema (summary)

| Table | Purpose |
|-------|---------|
| `debris_sightings` | Reports: location, AI fields, `jurisdiction`, `handoff_status`, `source_jurisdiction` |
| `drift_predictions` | 24/48/72 h lat/lon + speed/bearing snapshot at submit |
| `ocean_currents` | HYCOM-style grid for drift when glider not used |
| `vessels` | Fleet status, position, zone |
| `assignments` | Sighting ↔ vessel, intercept point, Groq brief |
| `supplies` | Zone inventory |

Full DDL: **`supabase_schema.sql`**.

---

## Demo Flow

1. `/report` — submit with photo or notes + coordinates (try Southern California for glider-informed drift).
2. `/dashboard` — see marker, drift, optional shore flag; use role selector and AI agent.
3. **Assign** an available vessel → brief modal.
4. `/vessel/:id` — crew view; adjust fuel/supplies.
5. **Handoff → EPA (partner)** — accept from partner role in selector.

---

## Future Ideas

- Live **ERDDAP** pull from [SprayData](https://spraydata.ucsd.edu/erddap) instead of static JSON snapshots.
- Auth, push notifications, AIS positions, richer coastline geometry for landfall.
- Train / calibrate drift beyond single-vector + wobble.

---

## Contributing

Built by Shrivas Sudharsan at DataHacks 2026. PRs welcome.
