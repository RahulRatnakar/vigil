# SDD ledger — plan: vigil/docs/plans/2026-11-13-vigil-plan.md

Setup: Ruling: no git repository in this workspace — progress tracked here; "Checkpoint" = full Python + Node suites — cost if wrong: none (plan already says this).
Pre-flight: T1 vendors.json → T2 tagging and T4 normalizeVendor (same keys/aliases) · T2 advisories.json schema → T3 notify, T4 matchAdvisory, T5 page · T4 functions → T5/T6/T7.
Pre-flight: Ruling: CVE List (cvelistV5) records already carry vendor, product and version ranges (cna.affected) and usually CVSS — the collector takes `affected` and `cvss` from them first; NVD is only a CVSS fallback for our vendors — keeps NVD rate limits harmless — cost if wrong: some CVEs show no score until NVD scores them.
Task 1: Ruling: python.exe is blocked from opening .py files in this workspace (endpoint security) — local tests run through vigil-work/pytest.sh, which reads sources via cat; GitHub uses normal unittest — cost if wrong: none for production, local runner only.
Task 1: Ruling: vendor feeds that are HTML-only (SonicWall, Juniper, HPE/Aruba, VMware/Broadcom, WatchGuard, Synology, QNAP, Ubiquiti) are covered via CVE List only — no scraping of web pages — cost if wrong: advisories published before their CVE appear later.
Task 1: complete (tests: bash vigil-work/pytest.sh → 4/4 OK)
Task 2: Ruling: CVEs from vendors we don't use are dropped unless they're on CISA KEV (the plan said to keep them) — keeps advisories.json small — cost if wrong: an unmapped vendor's CVE is missed until its alias is added to vendors.json.
Task 2: Ruling: the CVE List fast path only reads the last 6 h of deltaLog; NVD does the 90-day/7-day backfill — limits raw fetches per run — cost if wrong: a run gap longer than 6 h relies on NVD.
Task 2: Ruling: sources live in collector/sources.py and fixtures are inline in test_collect.py (the plan had a sources/ package and a fixtures dir) — less sprawl — cost if wrong: none.
Task 2: complete (tests: bash vigil-work/pytest.sh → 12/12 OK)
Task 3: Ruling: notify() takes an optional 4th arg vmap (loads collector/vendors.json when omitted) to print vendor labels — cost if wrong: none.
Task 3: Ruling: added test_needs_both_switches (URL alone must not post) and a site/data/.gitignore for the .new.json hand-off file; Teams errors never fail the run — cost if wrong: none.
Task 3: complete (tests: bash vigil-work/pytest.sh → 15/15 OK; collect.yml written, runs only on GitHub)
Task 4: Ruling: vendors.json gains a "product_aliases" table (advisory product -> words seen in Device Type/Model); matchAdvisory/loadInventory take an optional vmap arg, else window.VIGIL_VENDORS — cost if wrong: a product named differently in the inventory shows "Vendor only" instead of Likely/Confirmed.
Task 4: Ruling: a device returns null (not affected) only when its version parses AND falls outside every range for a matching product; unparseable range bounds give Likely — cost if wrong: some extra Likely rows.
Task 4: complete (tests: node --test site/tests/match.test.mjs → 8/8 pass; Python 15/15 OK)
Task 5: Ruling: page split into index.html + app.js + fx.js (still no build step) — easier to maintain than one 1,500-line file — cost if wrong: none.
Task 5: Ruling: alert "new" = an advisory id not seen in this browser before, or one whose modified date moved on (stored as `known` in IndexedDB prefs); the first visit seeds silently — avoids an alert flood on first open and works even if feed timestamps lag — cost if wrong: none.
Task 5: Ruling: ?src=<relative .json> query lets tests point the page at fixtures; only same-site relative paths accepted — cost if wrong: none.
Task 5: Ruling: match.js improved from real fixture data — product words and model-number prefixes ("Meraki MX" -> MX68, "iDRAC9" -> PowerEdge server) and Likely devices listed alongside Confirmed ones; 2 new tests RED->GREEN — cost if wrong: some extra Likely matches.
Task 5: complete (tests: node --test site/tests/match.test.mjs → 10/10; browser: counts right, inventory persists, Forget clears IndexedDB and shows the prompt, only GETs in the network log, stale NVD shown amber)
Task 6: Ruling: refresh() is single-flight (a second call while one runs reuses it) — found when two overlapping refreshes raised the summary twice — cost if wrong: none.
Task 6: complete (tests: node --test → 10/10; browser: burst fixture +1 KEV +7 critical → fresh 8, one summary pop-up styled exploited, red pulse on, × (34px, aria-label Dismiss) closes it)
Task 7: Ruling: screenshots not possible (Claude window minimized, pane not rendering); verified by page probes instead — boot typed 10 lines (NVD "! stale"), hero = newest exploited alert with 3 devices · 2 clients, all three canvases drawn, Lite draws a static frame, 375px width has no horizontal overflow — cost if wrong: a visual flaw only a human eye would catch; the 30 fps guard is verified by reading the code, not by measurement.
Task 7: Ruling: Lite setting mirrored to localStorage "vigil-lite" so the boot screen can respect it before IndexedDB loads — cost if wrong: none.
Task 7: complete (tests: node --test → 10/10; Python 15/15)
Task 8: Ruling: workflow no longer commits advisories.json every 15 min; each run restores the previous file from the live Pages site (contents: read only). load_prev() treats a missing/garbage file as a fresh start (test_prev RED->GREEN) — avoids ~96 commits/day of a multi-MB file — cost if wrong: if the site is unreachable, one run back-fills 90 days again.
Task 8: Ruling: removed the employer and ISP names from the public vendors.json ignore list (those rows now show as "unmatched" in the browser) and moved the internal design + plan docs to vigil-work/docs (not uploaded) — public repo must not identify the company or person — cost if wrong: none.
Task 8: complete (tests: Python 17/17 OK, Node 10/10; browser re-check: 9 devices, 6 triage rows, hero CVE-2026-24001, no script errors)
Final review: self-review (no reviewer dispatched).
Final: minor (deferred): 30 fps cap verified by code reading only; animations could not be measured or screenshotted because the Claude window was minimized.
Final: minor (deferred): the ?src= fixture switch also works on the live site (same-site .json only, harmless).
Final: minor (deferred): the page loads two Google Fonts (no data sent); if the network blocks them, system fonts are used.
Final: minor (deferred): fake fixtures under site/tests are published with the site.
Upgrade 1: per-client tickets — VIGIL.clientTickets() (match.js) gives one ticket per client listing only that client's devices, with subject "[SEV] CVE – Vendor Product – Client", exploit status, fixed version and links; row button "Tickets (N)" with Copy subject / Copy ticket / Copy all. 2 tests RED->GREEN.
Upgrade 1: Ruling: 3D core uses a local three.js r160 (site/vendor/three.module.min.js, MIT) with additive glow sprites + fresnel shaders instead of post-processing bloom — one file, lighter on laptop GPUs — cost if wrong: glow slightly less soft than true bloom.
Upgrade 1: Ruling: boot now runs on every open (Lite skips it); when the browser blocks audio it shows ENGAGE (one click = full sound) and continues silently after 6 s — browsers forbid sound before a click unless autoplay is allowed for the site — cost if wrong: one extra click per open.
Upgrade 1: verified in browser (screenshots): boot rings/decode/feeds, 3D core with 5 vendor nodes, 7 beams, device hologram, drag rotation, core pauses off-Overview and in Lite; Python 17/17, Node 12/12.
