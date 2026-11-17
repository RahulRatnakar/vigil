# VIGIL — vulnerability watch · design

Status: draft for Rahul's approval · 2026-11-13

## 1. Intent

The team was asked for a dashboard that tells the team about new vulnerabilities **as soon as vendors publish them**, for **every vendor in the managed environment**, and shows **which of our devices and clients are affected**.

It must run from any computer with a browser and must not need admin rights, installs, or anything running on Rahul's laptop.

## 2. Goals, non-goals, anti-goals

**Goals**
- New advisories for our vendors show up within about 30 minutes of the vendor publishing them.
- Every advisory says how many of our devices, at which clients and teams, are affected. Device type, model and version are used where the inventory has them.
- Actively exploited issues (CISA KEV) and critical scores stand out and raise an alert.
- Opens on any computer or wall screen from one link, with no install.

**Non-goals (for now)**
- Scanning client networks or devices. It reads vendor advisories and our inventory spreadsheet only.
- Patching devices or creating ConnectWise tickets automatically. It offers ready-to-paste ticket text instead.
- A shared, multi-user "reviewed" status. Reviewed marks are kept per browser.

**Anti-goals: it fails if**
- Client or device data ever leaves the user's browser.
- It floods people with low-severity noise, so they stop looking.
- It needs admin rights, installs or a company server to work.
- It looks impressive but is slow or hard to act on.

## 3. Constraints

- No admin rights or installs on the laptop. Everything runs in the browser or in a free cloud service.
- The inventory (`Q4_PTM_Inventory.xlsx`, sheet *PTM Tracker*, 11,125 devices) contains client names, IPs and serials. It **stays local**.
- There are ~70 vendor spellings in the Manufacturer column, which normalise to ~35 vendors. ~1,550 rows have no usable vendor ("0", "Server", "#N/A") and can't be matched until cleaned.
- Free tiers only. Advisory sources must be public.

## 4. Approaches considered

| Approach | Summary | Verdict |
|---|---|---|
| A. Single HTML file | The page fetches feeds itself | **Rejected.** Most vendor feeds block browser requests (CORS), and it only checks while the page is open |
| **B. Hybrid cloud + browser** | A scheduled cloud job collects public advisories into one JSON file. The page shows them and matches them against the inventory **in the browser** | **Chosen.** Runs 24/7 without the laptop, no install, and client data never leaves the browser |
| C. Company-hosted server | IT runs the collector internally | Rejected for now. It depends on IT and is slow to get. B can move here later unchanged |

## 5. How it works

```
 Every 15 min (cloud, public data only)              In the browser (private data stays here)
 ┌──────────────────────────────────┐                ┌───────────────────────────────────────┐
 │ Collector job                    │                │ Dashboard page                        │
 │  • pull feeds: CISA KEV, CVE     │   advisories   │  • loads advisories.json              │
 │    list, NVD, vendor PSIRT feeds │ ─────────────▶ │  • user drops inventory .xlsx once     │
 │  • dedupe by CVE, add EPSS score │     .json      │    (remembered in this browser only)  │
 │  • tag with normalised vendor    │                │  • matches vendor → model → version    │
 │  • publish advisories.json       │                │  • shows exposure, alerts, ticket text │
 │  • optional Teams post (vendor-  │                └───────────────────────────────────────┘
 │    level only, no client data)   │
 └──────────────────────────────────┘
```

**Cloud side.** A GitHub repository with:
- a **GitHub Actions** workflow on a 15-minute schedule, which runs the collector script;
- **GitHub Pages**, which serves the dashboard page and the `advisories.json` the collector writes.

The repository holds code, public advisories, and a **vendor watch list**: vendor names only, no clients or devices. GitHub's scheduled jobs can start several minutes late, which is why the target is about 30 minutes, not instant.

**Advisory sources.** Each one must be checked in build step 1 to confirm it's public, machine-readable and not blocked:
- **CISA KEV** (JSON): actively exploited vulnerabilities.
- **CVE List** (cvelistV5 deltas): every new CVE, usually minutes after publication.
- **NVD API 2.0**: CVSS scores and affected-product data (CPE). A free API key raises the rate limit.
- **FIRST EPSS**: likelihood of exploitation.
- **Vendor feeds** where available: Fortinet, Cisco/Meraki, Palo Alto, SonicWall, Juniper, HPE/Aruba, VMware/Broadcom, Ubiquiti, Dell, Microsoft, Synology, QNAP, WatchGuard, Sophos and others. Vendors without a usable feed are covered through CVE List/NVD, which may be slower.

**Matching (in the browser).**
1. **Vendor.** A normalisation table maps the 70 spellings to ~35 vendors and each vendor to its CVE/CPE vendor names (e.g. "Fortigate", "Fortinet" → `fortinet`; "Ubiquiti Networks" → `ui`/`ubiquiti`).
2. **Product / device type.** Uses the advisory's product name or CPE against Device Type and Model (e.g. FortiOS ↔ firewall, ArubaOS ↔ AP).
3. **Version.** Uses "Current version" against the affected ranges where both are clean. Otherwise the result is shown as "possibly affected — version unknown".

Each match carries a confidence: **Confirmed**, **Likely** or **Vendor only**.

**Alerts.**
- **In the page:** a pop-up with a close button, a sound, a Windows notification (opt-in), and a red-edge pulse for actively exploited issues. This reuses the patterns from NOC Live.
- **Optional Teams post:** sent from the cloud through a Teams Workflows webhook, but only vendor-level ("Critical Fortinet CVE-…, exploited"), because the cloud doesn't know our clients.
- **Default rule:** alert when an advisory affects a vendor we have **and** it is either in CISA KEV or scored critical (CVSS ≥ 9.0). Adjustable on the page.

## 6. Screens (look inspired by the reference videos)

1. **Boot screen.** "VIGIL · THREAT GRID ONLINE", a live clock, and lines that type out as each feed is checked.
2. **Overview:**
   - the **hero threat** (newest critical item) in large type: CVE number, vendor, our exposure, and an exploited badge, with a slowly rotating wireframe of the affected device type;
   - a **vendor bubble cloud** (one bubble per vendor, sized by our device count, coloured by worst open severity, flaring when a new advisory lands);
   - floating glass panels: the latest advisories, the most exposed clients, and feed health;
   - the **plain triage list** underneath: severity, vendor, product, devices/clients affected, exploited, age, and Review / Copy ticket text / Open vendor advisory buttons.
3. **Advisories:** the full list with filters (vendor, severity, exploited, affects us, date range) and search.
4. **Exposure:** by client and by team: what each one is exposed to, ranked.
5. **Vendors:** each vendor's device count, open advisories, feed status and last check time.
6. **Settings:** load or replace the inventory, alert rules, sound/notifications, Lite mode.

**Visual rules:**
- dark theme with teal for calm, amber for high and red for critical/exploited;
- a slowly flowing background that shifts to red when something exploited is open;
- big expressive type only for the top status line;
- effects pause when the page is hidden, and Lite mode turns them off.

## 7. Decided so far

- Name: **VIGIL** (Rahul asked for a cool name with no "NOC" in it).

- Approach B (hybrid): Rahul's choice.
- The inventory is processed only in the browser.
- The laptop only ever runs a web page in the browser. All scripts run in the cloud.
- The look takes ideas from the three reference videos: boot screen, hero, bubble cloud, glass panels, wireframe, flowing background.

## 8. Builder's calls (Claude's proposals, can be changed)

- **Hosting:** GitHub Actions + GitHub Pages, because it's free, there's nothing to run, and the page and data live in one place.
- **Collector:** written in Python and run **only on GitHub's servers**: nothing is installed or run on the laptop, so no approvals or admin rights are involved. The laptop only opens the web page.
- **Dashboard:** a single HTML file with no build step, in the same style as NOC Live.
- **Inventory memory:** kept in the browser (IndexedDB), with a "forget inventory" button.
- **Data kept:** 90 days of advisories in `advisories.json`, with older ones dropped.
- **Vendor watch list:** generated once from the inventory's Manufacturer column (names only), then edited by hand.

## 9. Build order

1. **Source check:** confirm each feed (public, readable, update speed) and build the vendor normalisation table.
2. **Collector:** combine sources into `advisories.json`, add EPSS and KEV flags, and run it on a 15-minute schedule.
3. **Dashboard core:** load the advisories, load the inventory, match, and show the triage list and Exposure page.
4. **Alerts:** in the page, then optionally Teams.
5. **The visual layer:** boot screen, hero, bubble cloud, glass panels, background, Lite mode.

## 10. Calls made during review (Claude's, can be changed)

- **Inventory input:** the *PTM Tracker* sheet, using the columns Client, Team, Device, Manufacturer, Device Type, Model, Current version, Status Q4. Rows marked Decommissioned or Client offboarded are ignored. Re-dropping a newer monthly file replaces the old one.
- **"New" means** an advisory published or updated since the user last opened the page in that browser.
- **Unknown vendors:** the ~1,550 rows with no usable Manufacturer are listed on the Vendors page as "unmatched", so they're visible rather than silently skipped.

## 11. Open questions (Rahul's to answer)

1. **GitHub account.** **Answered: Rahul's personal GitHub**, as a public repository holding code, public advisories and the vendor watch list only. Setup steps (creating the repository and turning on Pages) are done by Rahul in the GitHub website; Claude provides the files and click-by-click steps.
2. **Teams alerts.** **Answered: not for now; add later.** The first version alerts in the page only (pop-up, sound, optional Windows notification). The collector keeps a disabled hook for a Teams Workflows webhook so adding it later is one secret plus a switch, with no rebuild. Rahul will check with IT/manager before enabling it.
3. **Shared or personal review marks.** **Answered: personal.** "Reviewed" marks live in each person's browser. Shared marks may come later if the team uses it together.

All open questions are answered.
