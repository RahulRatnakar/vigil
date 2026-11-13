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
