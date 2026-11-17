import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const V = require('../match.js');
const VMAP = JSON.parse(readFileSync(new URL('../../collector/vendors.json', import.meta.url), 'utf8'));
globalThis.VIGIL_VENDORS = VMAP;

const row = (o) => ({ Client: 'Client A', Team: 'Team 1', Device: 'fw01', Manufacturer: 'Fortigate', 'Device Type': 'Firewall',
  Model: 'FortiGate 60F', 'Current version': '7.0.12', 'Status Q4': 'Upgraded', ...o });
const fortiAdv = (o = {}) => ({ id: 'CVE-2026-1111', vendor: 'fortinet', products: ['FortiOS'], kev: false, cvss: 9.8,
  affected: [{ product: 'FortiOS', versions: [{ from: '7.0.0', to_excl: '7.0.14', to_incl: null }] }], ...o });
const devs = (...rows) => V.loadInventory(rows.map(row), VMAP).devices;

test('vendor parity', () => {
  const cases = { Fortigate: 'fortinet', Fortinet: 'fortinet', 'Cisco Systems, Inc': 'cisco', Meraki: 'cisco',
    'Ubiquiti Networks': 'ubiquiti', 'Dell Inc.': 'dell', 'VMware VCO': 'vmware' };
  for (const [raw, key] of Object.entries(cases)) assert.equal(V.normalizeVendor(raw, VMAP), key, raw);
  for (const raw of ['0', '#N/A', 'Server', '', 'Unmanaged', null, undefined]) assert.equal(V.normalizeVendor(raw, VMAP), null, String(raw));
});

test('inventory drops offboarded and lists unmatched', () => {
  const inv = V.loadInventory([row({}), row({ 'Status Q4': 'Decommissioned' }), row({ 'Status Q4': 'Client offboarded' }),
    row({ Manufacturer: '0' }), row({ Manufacturer: '0' }), row({ Manufacturer: '#N/A' }), row({ Manufacturer: 'Server' })], VMAP);
  assert.equal(inv.devices.length, 1);
  assert.deepEqual(Object.keys(inv.devices[0]).sort(), ['client', 'device', 'model', 'team', 'type', 'vendor', 'version']);
  const un = Object.fromEntries(inv.unmatched.map((u) => [u.raw, u.count]));
  assert.deepEqual(un, { 0: 2, '#N/A': 1, Server: 1 });
});

test('confirmed match', () => {
  const m = V.matchAdvisory(fortiAdv(), devs({}));
  assert.equal(m.confidence, 'Confirmed');
  assert.deepEqual(m.clients, ['Client A']);
  assert.deepEqual(m.teams, ['Team 1']);
});

test('version outside range', () => {
  assert.equal(V.matchAdvisory(fortiAdv(), devs({ 'Current version': '7.0.15' })).confidence, null);
});

test('messy version never confirmed', () => {
  assert.equal(V.matchAdvisory(fortiAdv(), devs({ 'Current version': 'v7.0.12 build0523' })).confidence, 'Confirmed');
  for (const v of ['7.2.x', '', 'N/A']) {
    assert.equal(V.matchAdvisory(fortiAdv(), devs({ 'Current version': v })).confidence, 'Likely', v);
    const other = fortiAdv({ products: ['FortiWeb'], affected: [{ product: 'FortiWeb', versions: [{ from: '7.0.0', to_excl: '7.0.14' }] }] });
    assert.equal(V.matchAdvisory(other, devs({ 'Current version': v })).confidence, 'Vendor only', v);
  }
});

test('vendor only', () => {
  const d = devs({}, { Device: 'fw02', Client: 'Client B' });
  const m = V.matchAdvisory({ id: 'FORTINET:x', vendor: 'fortinet', products: [], affected: [] }, d);
  assert.equal(m.confidence, 'Vendor only');
  assert.equal(m.devices.length, 2);
});

test('cmpVersion', () => {
  assert.equal(V.cmpVersion('7.0.12', '7.0.14'), -1);
  assert.equal(V.cmpVersion('7.0', '7.0.0'), 0);
  assert.equal(V.cmpVersion('10.1', '9.9'), 1);
  assert.equal(V.cmpVersion('7.2.x', '7.0'), null);
  assert.equal(V.cmpVersion('', '7.0'), null);
});

test('alert rule', () => {
  const d = devs({});
  const vo = { id: 'X', vendor: 'fortinet', products: [], affected: [], kev: true, cvss: null };
  assert.equal(V.isAlert(vo, V.matchAdvisory(vo, d)), true);
  const crit = fortiAdv({ cvss: 9.8 });
  assert.equal(V.isAlert(crit, V.matchAdvisory(crit, d)), true);
  const high = fortiAdv({ cvss: 8.1 });
  assert.equal(V.isAlert(high, V.matchAdvisory(high, d)), false);
  const none = fortiAdv({ vendor: 'cisco', kev: true });
  assert.equal(V.isAlert(none, V.matchAdvisory(none, d)), false);
  assert.equal(V.isAlert(high, V.matchAdvisory(high, d), { kev: true, cvssMin: 8.0 }), true);
});

test('model numbers and product words', () => {
  const d = devs({ Manufacturer: 'Meraki', 'Device Type': 'Firewall', Model: 'MX68', 'Current version': 'MX 18.107' },
    { Manufacturer: 'Meraki', Device: 'sw', 'Device Type': 'Switch', Model: 'MS120-8', 'Current version': '15.21' });
  const mx = V.matchAdvisory({ id: 'A', vendor: 'cisco', products: ['Meraki MX'], affected: [] }, d);
  assert.equal(mx.confidence, 'Likely');
  assert.deepEqual(mx.devices.map((x) => x.model), ['MX68']);
  const dr = V.matchAdvisory({ id: 'B', vendor: 'dell', products: ['iDRAC9'], affected: [] },
    devs({ Manufacturer: 'Dell Inc.', 'Device Type': 'Server', Model: 'PowerEdge R650', 'Current version': '' }));
  assert.equal(dr.confidence, 'Likely');
});

test('likely devices are listed alongside confirmed ones', () => {
  const mm = V.matchAdvisory(fortiAdv(), devs({}, { Device: 'fw2', Client: 'Client B', 'Current version': '7.2.x' }, { Device: 'fw3', 'Current version': '7.0.15' }));
  assert.equal(mm.confidence, 'Confirmed');
  assert.deepEqual(mm.devices.map((x) => x.device).sort(), ['fw01', 'fw2']);
  assert.deepEqual(mm.clients, ['Client A', 'Client B']);
});

test('one ticket per client, each with only its own devices', () => {
  const d = devs({}, { Device: 'fw-b1', Client: 'Client B', Team: 'Team 2', 'Current version': '7.0.10' }, { Device: 'fw-b2', Client: 'Client B', Team: 'Team 2', 'Current version': '7.2.x' });
  const a = fortiAdv({ kev: true, title: 'FortiOS heap overflow', urls: ['https://fortiguard.test/FG-IR-26-1'] });
  const t = V.clientTickets(a, V.matchAdvisory(a, d), (k) => (k === 'fortinet' ? 'Fortinet' : k));
  assert.deepEqual(t.map((x) => x.client), ['Client A', 'Client B']);
  const b = t[1];
  assert.match(b.subject, /CRITICAL/);
  assert.match(b.subject, /CVE-2026-1111/);
  assert.match(b.subject, /Client B/);
  assert.equal(b.devices.length, 2);
  assert.match(b.body, /fw-b1/);
  assert.match(b.body, /fw-b2/);
  assert.doesNotMatch(b.body, /Client A|fw01/);        // never leak another client's devices
  assert.match(b.body, /actively exploited/i);
  assert.match(b.body, /7\.0\.14/);                    // fixed version from the affected range
  assert.match(b.body, /fortiguard\.test/);
  assert.equal(t[0].team, 'Team 1');
});

test('no matched devices gives no tickets', () => {
  assert.deepEqual(V.clientTickets(fortiAdv(), { confidence: null, devices: [], clients: [], teams: [] }, (k) => k), []);
});

const twoBranch = (o = {}) => fortiAdv({ affected: [{ product: 'FortiOS', versions: [{ from: '7.0.0', to_excl: '7.0.14' }, { from: '7.2.0', to_excl: '7.2.8' }] }], ...o });

test('remediation: one line per device, on its own branch', () => {
  const [d1, d2] = devs({}, { Device: 'fw2', 'Current version': 'v7.2.5 build1517' });
  assert.equal(V.remediation(twoBranch(), d1), 'Upgrade FortiOS 7.0.12 → 7.0.14 or later');
  assert.equal(V.remediation(twoBranch(), d2), 'Upgrade FortiOS 7.2.5 → 7.2.8 or later');
});

test('remediation: unknown version lists every fixed branch', () => {
  const [d] = devs({ 'Current version': '' });
  assert.equal(V.remediation(twoBranch(), d), 'Upgrade FortiOS to 7.0.14+ or 7.2.8+ (running version unknown)');
});

test('remediation: "up to and including" ranges', () => {
  const [d] = devs({ 'Current version': '7.0.12' });
  const a = fortiAdv({ affected: [{ product: 'FortiOS', versions: [{ from: '7.0.0', to_incl: '7.0.13' }] }] });
  assert.equal(V.remediation(a, d), 'Upgrade FortiOS 7.0.12 → a release newer than 7.0.13');
});

test('remediation: falls back to the vendor solution text, then a generic line', () => {
  const [d] = devs({});
  const noRange = fortiAdv({ affected: [], fix: 'Upgrade to FortiOS 7.0.14 or above.\nSee the advisory for details.' });
  assert.equal(V.remediation(noRange, d), 'Upgrade to FortiOS 7.0.14 or above.');
  assert.equal(V.remediation(fortiAdv({ affected: [] }), d), 'Apply the fixed release from the vendor advisory');
});

test('advisoryFix: short summary for the row', () => {
  assert.equal(V.advisoryFix(twoBranch()), 'FortiOS → 7.0.14+ · 7.2.8+');
  assert.equal(V.advisoryFix(fortiAdv({ affected: [], fix: 'Disable SSL-VPN until patched. More text.' })), 'Disable SSL-VPN until patched.');
  assert.equal(V.advisoryFix(fortiAdv({ affected: [] })), null);
});

test('tickets carry each device its own upgrade line', () => {
  const d = devs({ Client: 'Client B', 'Current version': '7.0.10' });
  const a = twoBranch();
  const [t] = V.clientTickets(a, V.matchAdvisory(a, d), (k) => k);
  assert.match(t.body, /fw01 .* version 7\.0\.10 → upgrade to 7\.0\.14 or later/);
});

const WATCH = { vendors: { Citrix: ['NetScaler', 'Cloud Software Group'] } };
const ctx = { id: 'CVE-2026-9999', vendor: 'citrix', products: ['NetScaler ADC'], affected: [], kev: true, cvss: 9.3 };

test('watch list: same merge as the collector', () => {
  const vm = V.mergeWatch(VMAP, WATCH);
  assert.equal(V.normalizeVendor('Citrix Systems, Inc.', vm), 'citrix');
  assert.equal(V.normalizeVendor('NetScaler', vm), 'citrix');
  assert.equal(vm.vendors.citrix.label, 'Citrix');
  assert.equal(vm.vendors.citrix.watch, true);
  assert.equal(VMAP.vendors.citrix, undefined);          // original map untouched
  assert.equal(V.mergeWatch(VMAP, 'garbage'), VMAP);
});

test('watched vendor with no devices: shows as Watched and still alerts', () => {
  const vm = V.mergeWatch(VMAP, WATCH);
  const mm = V.matchAdvisory(ctx, devs({}), vm);
  assert.equal(mm.confidence, 'Watched');
  assert.equal(mm.devices.length, 0);
  assert.equal(V.isAlert(ctx, mm), true);
  const mild = { ...ctx, kev: false, cvss: 7.5 };
  assert.equal(V.isAlert(mild, V.matchAdvisory(mild, [], vm)), false);
});

test('watched vendor that is in the tracker matches normally', () => {
  const vm = V.mergeWatch(VMAP, WATCH);
  const d = V.loadInventory([row({ Manufacturer: 'Citrix', 'Device Type': 'Load balancer', Model: 'NetScaler ADC VPX', 'Current version': '14.1' })], vm).devices;
  const mm = V.matchAdvisory(ctx, d, vm);
  assert.equal(mm.confidence, 'Likely');
  assert.equal(mm.devices.length, 1);
});

const swAdv = (o = {}) => ({ id: 'CVE-2026-1001', vendor: 'sonicwall', title: 'SonicOS SSLVPN improper access control', products: ['SonicOS'],
  refs: ['SNWLID-2026-0019'], affected: [], kev: false, cvss: 6.5, ...o });

test('search: CVE, SNWLID, product and words, any case', () => {
  const list = [swAdv(), fortiAdv({ title: 'FortiOS heap overflow', refs: [] })];
  const ids = (q) => V.searchAdvisories(list, q, (k) => k).map((a) => a.id);
  assert.deepEqual(ids('cve-2026-1001'), ['CVE-2026-1001']);
  assert.deepEqual(ids('snwlid-2026-0019'), ['CVE-2026-1001']);
  assert.deepEqual(ids('0019'), ['CVE-2026-1001']);
  assert.deepEqual(ids('fortios heap'), ['CVE-2026-1111']);
  assert.deepEqual(ids('sonicwall sslvpn'), ['CVE-2026-1001']);
  assert.deepEqual(ids(''), ['CVE-2026-1001', 'CVE-2026-1111']);
  assert.deepEqual(ids('nothing-like-this'), []);
});

test('alert rule: every new SonicWall advisory (SNWLID) when switched on', () => {
  const d = devs({ Manufacturer: 'SonicWall, Inc.', 'Device Type': 'Firewall', Model: 'TZ470', 'Current version': '7.0.1' });
  const a = swAdv();
  const mm = V.matchAdvisory(a, d);
  assert.equal(V.isAlert(a, mm, { kev: true, cvssMin: 9 }), false);
  assert.equal(V.isAlert(a, mm, { kev: true, cvssMin: 9, snwl: true }), true);
  assert.equal(V.isAlert(a, V.matchAdvisory(a, []), { kev: true, cvssMin: 9, snwl: true }), false);   // no SonicWall gear
});

test('search: words containing "s" are not split apart', () => {
  const list = [swAdv({ id: 'CVE-2026-2002', title: 'SSO session bypass in SMA', products: ['SMA 100'] }), swAdv()];
  assert.deepEqual(V.searchAdvisories(list, 'sessions', (k) => k).map((a) => a.id), []);
  assert.deepEqual(V.searchAdvisories(list, 'session bypass', (k) => k).map((a) => a.id), ['CVE-2026-2002']);
});
