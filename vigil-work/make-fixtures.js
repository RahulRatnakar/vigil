// builds fake fixtures for browser checks: no real client or device data. Run from vigil/.
const fs = require('fs'), path = require('path');
const XLSX = require(path.resolve('site/vendor/xlsx.full.min.js'));
const H = ['Client', 'Team', 'Device', 'Manufacturer', 'Device Type', 'Model', 'Current version', 'Status Q4'];
const rows = [
  ['Acme Dental', 'Team Blue', 'acme-fw01', 'Fortigate', 'Firewall', 'FortiGate 60F', '7.0.12', 'Upgraded'],
  ['Acme Dental', 'Team Blue', 'acme-sw01', 'Meraki', 'Switch', 'MS120-8', 'MS 15.21', 'Upgraded'],
  ['Birch Legal', 'Team Red', 'birch-fw01', 'Fortinet', 'Firewall', 'FortiGate 100F', 'v7.0.10 build0450', 'Pending'],
  ['Birch Legal', 'Team Red', 'birch-fw02', 'Fortinet', 'Firewall', 'FortiGate 40F', '7.2.x', 'Pending'],
  ['Birch Legal', 'Team Red', 'birch-esx1', 'VMware, Inc.', 'Server', 'ESXi host', '7.0.3', 'Upgraded'],
  ['Cedar Clinic', 'Team Green', 'cedar-fw01', 'Fortigate', 'Firewall', 'FortiGate 60E', '7.0.15', 'Upgraded'],
  ['Cedar Clinic', 'Team Green', 'cedar-srv1', 'Dell Inc.', 'Server', 'PowerEdge R650', '', 'Upgraded'],
  ['Cedar Clinic', 'Team Green', 'cedar-ap01', 'Ubiquiti Networks', 'Access Point', 'UniFi U6-Lite', '6.5.62', 'Upgraded'],
  ['Delta Freight', 'Team Blue', 'delta-mx1', 'Meraki', 'Firewall', 'MX68', 'MX 18.107', 'Upgraded'],
  ['Delta Freight', 'Team Blue', 'delta-old', 'Fortigate', 'Firewall', 'FortiGate 30E', '6.0.4', 'Decommissioned'],
  ['Elm Studio', 'Team Red', 'elm-x', '0', 'Unknown', '', '', 'Pending'],
  ['Elm Studio', 'Team Red', 'elm-y', '#N/A', 'Unknown', '', '', 'Pending'],
  ['Elm Studio', 'Team Red', 'elm-z', 'Server', 'Server', '', '', 'Pending'],
  ['Fir Labs', 'Team Green', 'fir-fw1', 'Fortigate', 'Firewall', 'FortiGate 80F', '7.0.13', 'Client offboarded'],
];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Summary'], ['ignore me']]), 'Summary');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([H, ...rows]), 'PTM Tracker');
fs.writeFileSync('site/tests/fixtures/inventory-sample.xlsx', XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));

const now = Date.now(), ago = (h) => new Date(now - h * 3600e3).toISOString().replace(/\.\d+Z$/, 'Z');
const sev = (s) => (s == null ? null : s >= 9 ? 'critical' : s >= 7 ? 'high' : s >= 4 ? 'medium' : 'low');
const A = (o) => {
  const a = { title: '', vendor: null, products: [], affected: [], cvss: null, kev: false, epss: null,
    published: ago(2), modified: ago(2), urls: [], sources: ['cvelist'], ...o };
  return { ...a, severity: sev(a.cvss) };
};
const advs = [
  A({ id: 'CVE-2026-24001', title: 'FortiOS SSL-VPN heap overflow allows remote code execution', vendor: 'fortinet', products: ['FortiOS'],
    affected: [{ product: 'FortiOS', versions: [{ from: '7.0.0', to_excl: '7.0.14', to_incl: null }] }], cvss: 9.8, kev: true, epss: 0.91,
    urls: ['https://www.fortiguard.com/psirt/FG-IR-26-001', 'https://nvd.nist.gov/vuln/detail/CVE-2026-24001'],
    sources: ['kev', 'cvelist', 'fortinet'], published: ago(1), modified: ago(1) }),
  A({ id: 'CVE-2026-23950', title: 'Meraki MX dashboard authentication bypass', vendor: 'cisco', products: ['Meraki MX'], cvss: 8.6,
    urls: ['https://sec.cloudapps.cisco.com/security/center/publicationListing.x'], sources: ['cisco', 'nvd'], published: ago(5), modified: ago(3) }),
  A({ id: 'CVE-2026-23811', title: 'iDRAC9 privilege escalation', vendor: 'dell', products: ['iDRAC9'],
    affected: [{ product: 'iDRAC9', versions: [{ from: null, to_excl: '7.10.50', to_incl: null }] }], cvss: 7.8,
    urls: ['https://www.dell.com/support/security/'], published: ago(30), modified: ago(30) }),
  A({ id: 'CVE-2026-23700', title: 'VMware ESXi VMX out-of-bounds write', vendor: 'vmware', products: ['ESXi'],
    affected: [{ product: 'ESXi', versions: [{ from: '7.0', to_excl: '7.0.3.5', to_incl: null }] }], cvss: 9.3, kev: true,
    urls: ['https://support.broadcom.com/'], sources: ['kev', 'cvelist'], published: ago(50), modified: ago(20) }),
  A({ id: 'CVE-2026-22000', title: 'UniFi Network Application command injection', vendor: 'ubiquiti', products: ['UniFi Network Application'], cvss: 10.0,
    urls: ['https://community.ui.com/releases'], published: ago(70), modified: ago(70) }),
  A({ id: 'CVE-2026-21000', title: 'Acme Toaster OS default credentials', vendor: null, products: ['Toaster OS'], cvss: 9.1, kev: true,
    urls: ['https://nvd.nist.gov/vuln/detail/CVE-2026-21000'], sources: ['kev'], published: ago(10), modified: ago(10) }),
  A({ id: 'CVE-2026-20500', title: 'FortiWeb path traversal', vendor: 'fortinet', products: ['FortiWeb'],
    affected: [{ product: 'FortiWeb', versions: [{ from: '7.0.0', to_excl: '7.0.9' }] }], cvss: 6.5,
    urls: ['https://www.fortiguard.com/psirt/FG-IR-26-002'], published: ago(120), modified: ago(120) }),
];
const ok = (h) => ({ status: 'ok', checked: ago(h), error: null });
const sources = { kev: ok(0.1), cvelist: ok(0.1), nvd: { status: 'stale', checked: ago(0.1), error: 'HTTPError: 503 Service Unavailable' },
  fortinet: ok(0.1), cisco: ok(0.1), paloalto: ok(0.1), microsoft: ok(0.1), sophos: ok(0.1), epss: ok(0.1) };
fs.writeFileSync('site/tests/fixtures/advisories.json', JSON.stringify({ generated: ago(0.1), last_run: ago(0.1), sources, advisories: advs }, null, 1));

// a later refresh adding 1 KEV + 7 critical, for the alert burst check
const extra = [A({ id: 'CVE-2026-25000', title: 'FortiOS fgfmd unauthenticated RCE', vendor: 'fortinet', products: ['FortiOS'], cvss: 9.6, kev: true,
  published: ago(0), modified: ago(0), urls: ['https://www.fortiguard.com/psirt/FG-IR-26-010'] })];
for (let i = 1; i <= 7; i++) extra.push(A({ id: `CVE-2026-2510${i}`, title: `Meraki MX critical flaw #${i}`, vendor: 'cisco', products: ['Meraki MX'],
  cvss: Math.round((9 + i / 10) * 10) / 10, published: ago(0), modified: ago(0), urls: ['https://sec.cloudapps.cisco.com/'] }));
fs.writeFileSync('site/tests/fixtures/advisories-burst.json', JSON.stringify({ generated: ago(0), last_run: ago(0), sources, advisories: [...extra, ...advs] }, null, 1));
console.log('fixtures ok');
