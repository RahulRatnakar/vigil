# VIGIL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build VIGIL. A GitHub-hosted collector gathers public vulnerability advisories every 15 minutes, and a browser dashboard matches them against the local inventory spreadsheet and alerts on what affects us.

**Architecture:** A Python collector (standard library only) runs in GitHub Actions on a 15-minute schedule. It writes `site/data/advisories.json` and deploys `site/` to GitHub Pages. The dashboard (`site/index.html` + `site/match.js`) loads that JSON and matches it in the browser against the user's `.xlsx` inventory, which never leaves the browser.

**Tech Stack:**
- **Collector:** Python 3.12 standard library (`urllib`, `json`, `datetime`), tested with `unittest`.
- **Dashboard:** plain HTML/CSS/JS, with SheetJS (a local copy in `site/vendor/`) for reading `.xlsx`.
- **Tests:** Node `node:test` for `match.js`.
- **Hosting:** GitHub Actions + GitHub Pages (Source: "GitHub Actions").

**Spec:** `vigil/docs/2026-11-13-vigil-design.md`

## Global Constraints

- Name is **VIGIL**. No "NOC" anywhere in names, titles or copy.
- **No client or device data** (client names, device names, IPs, serials) in the repository, in `advisories.json`, or sent anywhere. Inventory is processed only in the browser.
- **Nothing runs on the user's laptop** except opening the web page. No installs, no admin rights.
- **Free tiers only.** The repository is **public**, on Rahul's personal GitHub.
- **Schedule:** collector cron every **15 minutes**. Target delay vendor → dashboard **≈30 minutes**.
- **Retention:** keep advisories **90 days** (by published or modified date, whichever is later).
- **Default alert rule:** advisory affects a vendor we have **and** (`kev == true` **or** `cvss >= 9.0`). Adjustable in Settings.
- **Match confidence labels:** exactly `Confirmed`, `Likely`, `Vendor only`.
- **Inventory input:** sheet `PTM Tracker`, columns `Client, Team, Device, Manufacturer, Device Type, Model, Current version, Status Q4`. Rows with Status Q4 `Decommissioned` or `Client offboarded` are ignored.
- **Teams hook ships disabled.** It is enabled only when both secret `VIGIL_TEAMS_URL` and variable `VIGIL_TEAMS=on` exist. Messages are vendor-level only.
- **Personal review marks** in browser storage. No shared backend.
- **Effects pause when the page is hidden.** Lite mode turns all effects off.
- The local workspace is not a git repository. "Checkpoint" steps run the full test suite instead of committing. Rahul uploads the finished files to GitHub in Task 8.

## Review Focus

1. **Junk Manufacturer values** ("0", "#N/A", "Server", "Unmanaged", blank) must land in an **unmatched** list shown on the Vendors page, never crash or silently match. *Test in Task 1 and Task 4.*
2. **A feed that is down, blocked, rate-limited or returns garbage** must not fail the whole run. The previous data for that source stays, and that source's status becomes `stale` with the error text. *Test in Task 2.*
3. **The same CVE from several sources** (KEV + CVE list + vendor feed) must produce **one** advisory with merged fields, not duplicates. *Test in Task 2.*
4. **Messy version strings** ("v7.0.12 build0523", "7.2.x", blank, "N/A") must never produce `Confirmed`. They fall back to `Likely` or `Vendor only`. *Test in Task 4.*
5. **First run or a long outage** must not hammer NVD. The collector fetches only changes since `last_run` (capped at 7 days back), with pauses between requests. *Test in Task 2.*

---

### Task 1: Vendor map and source check

**Files:**
- Create: `vigil/collector/vendors.json`
- Create: `vigil/docs/sources.md`
- Test: `vigil/collector/tests/test_vendors.py`

**Interfaces:**
- Produces `vendors.json`: `{"vendors": {"<key>": {"label": str, "aliases": [str], "cve_names": [str], "feeds": [str]}}, "ignore": [str]}`
  - `key` is lowercase, e.g. `fortinet`.
  - `aliases` are inventory spellings, matched case- and punctuation-insensitively.
  - `cve_names` are lowercase vendor/product strings as they appear in CVE/NVD CPE data, e.g. `fortinet`, `ui`, `paloaltonetworks`.
  - `feeds` are source ids from `sources.md`.
  - `ignore` holds known non-vendor values: `0`, `#n/a`, `server`, `unmanaged`, `isp`, `ups`, `meriplex`.
- Produces `normalize_vendor(raw: str, vmap: dict) -> str | None` in `vigil/collector/vendors.py` (mirrored in JS by Task 4).

- [ ] **Step 1: List the inventory's Manufacturer spellings locally.** Read only the Manufacturer column of `Q4_PTM_Inventory.xlsx`, sheet `PTM Tracker`, and print the distinct values with counts. Do not save client data anywhere.
- [ ] **Step 2: Check each source by hand** (public, machine-readable, update frequency, needs a key?) and write `docs/sources.md`, one row per source:
  - **Cross-vendor:** CISA KEV JSON, cvelistV5 deltas, NVD API 2.0, FIRST EPSS.
  - **Vendors:** Fortinet, Cisco/Meraki, Palo Alto, SonicWall, Juniper, HPE/Aruba, VMware/Broadcom, Ubiquiti, Dell, Microsoft, Synology, QNAP, WatchGuard, Sophos, Ruckus/CommScope, Netgear, Extreme, Lenovo, APC/Schneider.
  - **For a vendor without a usable feed,** write `none: CVE list/NVD only`.
- [ ] **Step 3: Write the failing test** `test_vendor_aliases`:
  - asserts `normalize_vendor("Fortigate", m) == "fortinet"`, `normalize_vendor("Fortinet", m) == "fortinet"`, `normalize_vendor("Cisco Systems, Inc", m) == "cisco"`, `normalize_vendor("Meraki", m) == "cisco"`, `normalize_vendor("Ubiquiti Networks", m) == "ubiquiti"`, `normalize_vendor("Dell Inc.", m) == "dell"`, `normalize_vendor("VMware VCO", m) == "vmware"`;
  - and `normalize_vendor("0", m) is None`, `normalize_vendor("#N/A", m) is None`, `normalize_vendor("Server", m) is None`, `normalize_vendor("", m) is None`.
- [ ] **Step 4: Run it to make sure it fails.** Run: `python -m unittest discover -s vigil/collector/tests -v`. Expected: FAIL (`vendors` module missing).
- [ ] **Step 5: Write `vendors.json`** covering every spelling from Step 1 that is a real vendor, and **implement** `normalize_vendor`: lowercase, strip punctuation and extra spaces, then exact alias lookup. Return `None` for `ignore` values and unknowns.
- [ ] **Step 6: Run the tests.** Expected: PASS.
- [ ] **Step 7: Checkpoint:** the full suite passes.

### Task 2: Collector

**Files:**
- Create: `vigil/collector/vigil_collect.py`
- Create: `vigil/collector/sources/` (one module per source: `kev.py`, `cvelist.py`, `nvd.py`, `epss.py`, `vendor_feeds.py`)
- Create: `vigil/collector/tests/fixtures/*.json|xml` (small saved samples of each source)
- Test: `vigil/collector/tests/test_collect.py`

**Interfaces:**
- Consumes: `vendors.json` and `normalize_vendor` (Task 1).
- Produces `site/data/advisories.json`:
  ```json
  { "generated": "ISO-8601 UTC", "last_run": "ISO-8601 UTC",
    "sources": { "<id>": { "status": "ok|stale", "checked": "ISO", "error": "str|null" } },
    "advisories": [ { "id": "CVE-…", "title": str, "vendor": "<key>|null", "products": [str],
      "affected": [ { "product": str, "versions": [ { "from": str|null, "to_excl": str|null, "to_incl": str|null } ] } ],
      "cvss": float|null, "severity": "critical|high|medium|low|null", "kev": bool, "epss": float|null,
      "published": "ISO", "modified": "ISO", "urls": [str], "sources": [str] } ] }
  ```
- Produces `run(now: datetime, prev: dict, fetch: Callable[[str], bytes]) -> dict`, where `fetch(url)` is injected so tests never touch the network.

- [ ] **Step 1: Write the failing tests:**
  - `test_merge_same_cve`: KEV + CVE list + vendor fixtures for one CVE make exactly one advisory, with `kev is True` and `sources` containing all three ids.
  - `test_source_failure_keeps_old`: `fetch` raises for `nvd`. The run finishes, `sources["nvd"]["status"] == "stale"`, `error` is not empty, and the previous NVD-derived `cvss` stays.
  - `test_retention_90_days`: an advisory with `modified` 91 days before `now` is dropped, and one at 89 days is kept.
  - `test_incremental_window`: with `prev["last_run"]` 30 days ago, the NVD request window starts at `now - 7 days`, not 30.
  - `test_vendor_tagging`: a CVE whose CPE vendor is `fortinet` gets `vendor == "fortinet"`. An unknown vendor gets `vendor is None` and is still kept.
  - `test_no_private_fields`: the output JSON contains none of the keys `client`, `device`, `ip`, `serial`.
- [ ] **Step 2: Run the tests to make sure they fail.** Run: `python -m unittest discover -s vigil/collector/tests -v`. Expected: FAIL.
- [ ] **Step 3: Implement the source modules and `run()`.**
  - Each source exposes `collect(since: datetime, fetch) -> list[dict]` returning partial advisories.
  - `run()` calls each source inside try/except and merges by `id`: OR the `kev` flags, take the max `cvss`, union `urls` and `sources`, and take the latest `modified`.
  - NVD requests sleep **6 s** between pages (the public limit). An `NVD_API_KEY` environment variable lowers this to **0.6 s**.
  - A `main()` entry point reads/writes `site/data/advisories.json`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Live smoke run (developer machine or a CI dry run):** `python vigil/collector/vigil_collect.py --dry-run`. It prints per-source counts and status and writes nothing.
- [ ] **Step 6: Checkpoint.**

### Task 3: GitHub workflow and disabled Teams hook

**Files:**
- Create: `vigil/.github/workflows/collect.yml`
- Create: `vigil/collector/teams.py`
- Test: `vigil/collector/tests/test_teams.py`

**Interfaces:**
- Consumes: `run()` output (Task 2).
- Produces `notify(new_advisories: list[dict], env: Mapping[str,str], post: Callable[[str, dict], None]) -> int`, returning the number posted.

- [ ] **Step 1: Write the failing tests:**
  - `test_disabled_by_default`: with no env, `notify(...) == 0` and `post` is never called.
  - `test_enabled_posts_vendor_level`: with `VIGIL_TEAMS_URL` and `VIGIL_TEAMS=on`, a KEV advisory is posted once. The payload text contains the CVE id and vendor label, and contains none of `client`, `device`, `ip`.
- [ ] **Step 2: Run them to make sure they fail.** Expected: FAIL.
- [ ] **Step 3: Implement `notify`.** It filters to advisories new in this run that match the default alert rule, then posts an Adaptive Card JSON to the URL.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Write `collect.yml`:**
  - triggers on `schedule: cron "*/15 * * * *"` and `workflow_dispatch`;
  - steps: checkout → setup-python 3.12 → `python -m unittest discover -s collector/tests` → `python collector/vigil_collect.py` → `python collector/teams.py` → `cp collector/vendors.json site/data/vendors.json` → commit `site/data/advisories.json` if changed → `actions/upload-pages-artifact` (path `site`) → `actions/deploy-pages`;
  - permissions: `contents: write`, `pages: write`, `id-token: write`;
  - concurrency group `vigil` with cancel-in-progress false.
- [ ] **Step 6: Checkpoint.**

### Task 4: Matching in the browser (`match.js`)

**Files:**
- Create: `vigil/site/match.js` (works both as a browser global `VIGIL` and as a Node module)
- Copy: `vigil/collector/vendors.json` → `vigil/site/data/vendors.json` (done in the workflow before deploy)
- Test: `vigil/site/tests/match.test.mjs`

**Interfaces:**
- Consumes: `advisories.json` (Task 2) and `vendors.json` (Task 1).
- Produces:
  - `normalizeVendor(raw: string, vmap) -> string|null`, behaving exactly like the Python version;
  - `loadInventory(rows: object[]) -> {devices: Device[], unmatched: {raw: string, count: number}[]}`, where `Device = {client, team, device, vendor, type, model, version}` and ignored statuses are dropped;
  - `matchAdvisory(adv, devices) -> {confidence: 'Confirmed'|'Likely'|'Vendor only'|null, devices: Device[], clients: string[], teams: string[]}`;
  - `cmpVersion(a: string, b: string) -> -1|0|1|null`, which returns `null` when either side can't be parsed;
  - `isAlert(adv, match, rule = {kev: true, cvssMin: 9.0}) -> boolean`.

- [ ] **Step 1: Write the failing tests:**
  - `vendor parity`: the same alias cases as Task 1 give the same results.
  - `inventory drops offboarded`: rows with Status Q4 `Decommissioned` or `Client offboarded` are excluded, and `0`/`#N/A`/`Server` show up in `unmatched` with counts.
  - `confirmed match`: a FortiOS advisory with range `7.0.0 ≤ v < 7.0.14` and a Fortinet firewall on `7.0.12` gives `Confirmed`.
  - `version outside range`: version `7.0.15` gives `null` (not affected).
  - `messy version never confirmed`: `"v7.0.12 build0523"` gives `Confirmed` only if it parses to `7.0.12`. `"7.2.x"`, `""` and `"N/A"` give `Likely` when the product matches and `Vendor only` otherwise.
  - `vendor only`: an advisory with a vendor but no product data gives `Vendor only`, covering every device of that vendor.
  - `alert rule`: KEV + `Vendor only` → true; cvss 9.8 → true; cvss 8.1 with no KEV → false; any advisory with no matching devices → false.
- [ ] **Step 2: Run the tests to make sure they fail.** Run: `node --test vigil/site/tests/`. Expected: FAIL.
- [ ] **Step 3: Implement `match.js`.**
  - Product matching compares lowercase tokens of the advisory `products`/`affected.product` against the device's `type` and `model`. The aliases are a small table in `vendors.json`, e.g. `fortios`↔`fortigate`/`firewall`.
  - Version parsing takes the first `\d+(\.\d+){1,3}` run.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Checkpoint.**

### Task 5: Dashboard core

**Files:**
- Create: `vigil/site/index.html` (structure, styles and app script; uses `match.js`)
- Create: `vigil/site/vendor/xlsx.full.min.js` (a pinned SheetJS copy, so there's no outside script at runtime)
- Create: `vigil/site/tests/fixtures/inventory-sample.xlsx` (fake clients/devices only)
- Test: browser verification (below)

**Interfaces:**
- Consumes: `VIGIL.*` from Task 4, `data/advisories.json` and `data/vendors.json`.
- Produces in-page state `S = {advisories, devices, unmatched, matches: Map<id, match>, reviewed: Set<id>, lastSeen: ISO, settings}`, persisted in IndexedDB `vigil` (stores `inventory`, `prefs`).

- [ ] **Step 1: Build the pages** using the design's screen list:
  - **Overview:** a plain triage list for now.
  - **Advisories:** filters for vendor, severity, exploited, affects-us and date range, plus search.
  - **Exposure:** by client and by team.
  - **Vendors:** device counts, open advisories, feed status from `sources`, and the unmatched list.
  - **Settings:** load/replace inventory, "Forget inventory", alert rule, sound, notifications, Lite mode.
- [ ] **Step 2: Build the row actions:**
  - **Review** toggles the personal mark.
  - **Copy ticket text** copies plain text with the CVE, title, severity, KEV, vendor, affected count, up to 20 affected devices as "client · device · version", and the advisory URLs.
  - **Open advisory** follows the first URL.
- [ ] **Step 3: Verify in the browser** with `inventory-sample.xlsx` and a fixture `advisories.json`:
  - the triage list shows the expected affected counts;
  - "Forget inventory" clears IndexedDB, and a reload shows the "load your inventory" prompt;
  - the Network panel shows **no requests** carrying inventory data;
  - an advisories file with a `stale` source shows that source amber on the Vendors page.
- [ ] **Step 4: Checkpoint.**

### Task 6: Alerts in the page

**Files:**
- Modify: `vigil/site/index.html`
- Test: `vigil/site/tests/match.test.mjs` (the `isAlert` cases already exist) plus browser verification

**Interfaces:**
- Consumes: `isAlert` (Task 4) and `S.lastSeen` (Task 5).

- [ ] **Step 1: Implement the alerts.** On load and on each data refresh (re-fetch `advisories.json` every **5 minutes**, cache-busted), advisories that are new since `S.lastSeen` and pass `isAlert` raise:
  - a pop-up with a visible **×**;
  - a sound (mutable);
  - an optional Windows notification (asks permission once, and only on a user click);
  - for KEV items, a 5-second red edge pulse.
- [ ] **Step 2: Batch bursts.** More than 5 alerts in one refresh become one summary pop-up ("12 new critical advisories").
- [ ] **Step 3: Verify in the browser** with a fixture refresh that adds 1 KEV advisory and 7 critical ones: one pulse, one summary pop-up, and the × closes it.
- [ ] **Step 4: Checkpoint.**

### Task 7: Visual layer (VIGIL look)

**Files:**
- Modify: `vigil/site/index.html`
- Test: browser verification with screenshots

**Interfaces:**
- Consumes: `S` and the matches (Task 5).

- [ ] **Step 1: Boot screen.** "VIGIL · THREAT GRID ONLINE", a live clock, and one line typed per source (`CISA KEV ✓`, `NVD ✓`, `Fortinet ✓`, … taken from `sources`). Skipped after the first visit of the day, or in Lite mode.
- [ ] **Step 2: Hero threat.** The newest `isAlert` advisory, else the highest-CVSS one: the CVE in large type, vendor, "N devices · M clients", an exploited badge, and a canvas wireframe of the device type (firewall/switch/AP/server shapes) slowly rotating on a lit platform.
- [ ] **Step 3: Vendor bubble cloud.** A canvas with one bubble per vendor, radius ∝ √(device count), coloured by the worst open severity (teal none, amber high, red critical/KEV), with thin links between vendors that share clients. A new advisory flares its bubble. Hovering shows vendor, devices and open advisories; clicking filters the Advisories page.
- [ ] **Step 4: Glass panels and background.** Latest advisories, most exposed clients and feed health as glass panels. A flowing dark background that tints red while any KEV item is unreviewed.
- [ ] **Step 5: Performance rules.** Canvases at most **30 fps**, stopped when `document.hidden` or in Lite mode. `prefers-reduced-motion` forces Lite.
- [ ] **Step 6: Verify:** screenshots of the boot screen, Overview with the hero and bubbles, Lite mode, and the narrow (phone-width) layout. The triage list stays usable in each.
- [ ] **Step 7: Checkpoint.**

### Task 8: Setup guide for Rahul (GitHub website only)

**Files:**
- Create: `vigil/docs/SETUP.md`
- Create: `vigil/README.md` (what VIGIL is, the privacy promise, and how to use it)

- [ ] **Step 1: Write click-by-click steps that use only the github.com website:**
  - create the public repository `vigil`;
  - upload the folder contents (drag and drop);
  - **Settings → Pages → Source: GitHub Actions**;
  - **Actions → enable**;
  - run "collect" once with "Run workflow";
  - open `https://<username>.github.io/vigil/`;
  - optional: add an `NVD_API_KEY` secret;
  - **later:** turning on Teams (`VIGIL_TEAMS_URL` secret + `VIGIL_TEAMS=on` variable).
- [ ] **Step 2: Add a "what to check" list:**
  - the site opens on the company network;
  - the boot screen shows each source as ✓;
  - dropping the inventory shows affected counts;
  - Lite mode works.
- [ ] **Step 3: Final checkpoint:** the Python and Node suites pass and every Task 5–7 browser check is re-run.
