# VIGIL advisory sources

These sources were checked on 2026-11-13 from a normal browser connection. "Usable" means it's public and machine-readable (JSON or RSS), and VIGIL reads it.

| id | Source | URL | Format | Usable | Notes |
|---|---|---|---|---|---|
| `kev` | CISA Known Exploited Vulnerabilities | https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json | JSON | ✅ | Actively exploited list. Sets the `kev` flag |
| `cvelist` | CVE List (CVEProject/cvelistV5) delta log | https://raw.githubusercontent.com/CVEProject/cvelistV5/main/cves/deltaLog.json | JSON | ✅ | Every new or updated CVE within minutes. Records carry vendor, product, version ranges and usually CVSS. **Main source** |
| `nvd` | NVD API 2.0 | https://services.nvd.nist.gov/rest/json/cves/2.0 | JSON | ✅ | CVSS fallback when the CVE record has none. 6 s between requests, or 0.6 s with the optional `NVD_API_KEY` secret |
| `epss` | FIRST EPSS | https://api.first.org/data/v1/epss | JSON | ✅ | Exploit-likelihood score, up to 100 CVEs per request |
| `fortinet` | FortiGuard PSIRT | https://www.fortiguard.com/rss/ir.xml | RSS | ✅ | Vendor advisories, sometimes before the CVE appears |
| `cisco` | Cisco PSIRT (covers Meraki) | https://sec.cloudapps.cisco.com/security/center/psirtrss20/CiscoSecurityAdvisory.xml | RSS | ✅ | |
| `sonicwall` | SonicWall PSIRT (SNWLID) | https://psirtapi.global.sonicwall.com/api/v1/vulnsummary/ | JSON | ✅ | Each SNWLID is filed under its CVEs (or its own ID when it has none) and shown as a label. Optional alert on every new SNWLID |
| `paloalto` | Palo Alto Networks | https://security.paloaltonetworks.com/json/ | JSON | ✅ | Includes severity and CVE ids |
| `microsoft` | Microsoft MSRC | https://api.msrc.microsoft.com/update-guide/rss | RSS | ✅ | Large feed. Only items mentioning CVE ids are kept |
| `sophos` | Sophos | https://www.sophos.com/en-us/security-advisories/feed | RSS | ✅ | |

**Covered through the CVE List only** (their advisory pages are web pages, not feeds):
- Juniper, HPE/Aruba, VMware/Broadcom, WatchGuard and Synology. These vendors file their own CVEs, so they still usually appear within minutes of publishing.
- Ubiquiti, QNAP, Dell, Ruckus, Netgear, ADTRAN, EnGenius, Lenovo, Extreme, Supermicro, Araknis and the rest of `collector/vendors.json`. Speed depends on when their CVE is published.
