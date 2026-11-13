# VIGIL

VIGIL tells you about new vulnerability advisories **for the vendors in our inventory** within about 30 minutes of publication, and shows which devices and clients each one touches.

## How it works

```
GitHub Actions (every 15 min)                Your browser
┌─────────────────────────────┐              ┌──────────────────────────────┐
│ collector/vigil_collect.py  │  advisories  │ site/index.html              │
│  CISA KEV · CVE List · NVD  │ ───────────► │  + your inventory .xlsx      │
│  EPSS · Fortinet · Cisco    │  .json via   │    (read here, never sent)   │
│  Palo Alto · MSRC · Sophos  │  GitHub Pages│  = what affects us, alerts   │
└─────────────────────────────┘              └──────────────────────────────┘
```

- **Collector** (Python standard library only, runs on GitHub's servers) gathers public advisories, merges duplicates, keeps 90 days, and publishes `data/advisories.json`.
- **Dashboard** (plain HTML/JS, no build step) matches advisories to the inventory **inside your browser** and alerts when something matters.

## Privacy promise

- Your inventory spreadsheet is read by your browser and kept only in that browser's storage. **It is never uploaded**, and **Forget inventory** removes it.
- The repository and `advisories.json` contain **only public advisory data** and vendor names: no clients, devices, IPs or serials.
- Review marks are personal to your browser.

## Using it

| Screen | What it's for |
|---|---|
| **Overview** | Hero threat, vendor grid, latest items, most exposed clients, feed health, and the **triage list** |
| **Advisories** | Everything, with filters for vendor, severity, exploited, affects us, date, and search (`/`) |
| **Exposure** | Ranked by client or by team |
| **Vendors** | Device counts, open items, feed status, and inventory rows with no usable Manufacturer |
| **Settings** | Load or forget the inventory, alert rule, sound, Windows notifications, Lite mode |

Each advisory row has three buttons:
- **Review** marks it as handled, for you only.
- **Copy ticket text** copies a ready-to-paste summary with up to 20 affected devices.
- **Open advisory** opens the vendor's page.

**Match confidence:**
- **Confirmed:** the product matches and the device version is inside the affected range.
- **Likely:** the product matches, but the version is unclear or can't be compared.
- **Vendor only:** we have that vendor, but the advisory's product isn't recognised in our inventory.

**Default alert rule:** the advisory affects a vendor we have, and it's either actively exploited (CISA KEV) or has CVSS ≥ 9.0. You can change this in Settings.

## Setup

See [docs/SETUP.md](docs/SETUP.md). It only needs the github.com website.

## Development

- **Collector tests:** `python -m unittest discover -s collector/tests`
- **Matching tests:** `node --test site/tests/match.test.mjs`
- **Vendor list:** `collector/vendors.json`. Add aliases there when the inventory uses a new spelling, and `product_aliases` when a product is named differently in the tracker.
- **Local preview with fixtures:** `site/index.html?src=tests/fixtures/advisories.json` with `site/tests/fixtures/inventory-sample.xlsx`. Both are fake data.
