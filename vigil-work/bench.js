// times matching with a synthetic inventory the size of the real one (fake names only). Run from vigil/.
const fs = require('fs');
const V = require('../vigil/site/match.js');
const vmap = JSON.parse(fs.readFileSync('collector/vendors.json', 'utf8'));
globalThis.VIGIL_VENDORS = vmap;
const pick = (a, i) => a[i % a.length];
const vendors = [['Meraki', 2806, ['MX68', 'MS120-8', 'MR36', 'MS250-48', 'Cisco Controller', 'WS-C3850-48P', 'AIR-CT2504-K9', 'Catalyst 9200', '0']],
  ['Fortigate', 573, ['FortiGate 60F', 'FortiGate 100F', 'FortiGate 40F', 'FortiSwitch 124E']], ['Dell Inc.', 407, ['PowerEdge R650', 'PowerEdge R740']],
  ['SonicWall, Inc.', 196, ['TZ470', 'NSA 2700']], ['Palo Alto Networks, Inc.', 142, ['PA-440', 'PA-3220']], ['Microsoft', 14, ['Windows Server']],
  ['HPE', 1500, ['Aruba 6300', 'ProLiant DL380', 'Nimble HF20']], ['Ubiquiti Networks', 1500, ['UniFi U6-Lite', 'USW-24']], ['0', 2108, ['']]];
const rows = [];
let n = 0;
for (const [m, count, models] of vendors) for (let i = 0; i < count; i++, n++)
  rows.push({ Client: 'Client ' + (n % 300), Team: 'Team ' + (n % 9), Device: 'dev' + n, Manufacturer: m, 'Device Type': pick(['Firewall', 'Switch', 'Access Point', 'Server'], i), Model: pick(models, i), 'Current version': pick(['17.9.4', 'MX 18.107', '7.0.12', 'v7.2.5 build1517', '', '15.21', '10.1.3', '9.1.2'], i * 7 + n), 'Status Q4': 'Upgraded' });
let t = Date.now();
const inv = V.loadInventory(rows, vmap);
console.log('devices', inv.devices.length, 'load ms', Date.now() - t);
const keys = ['cisco', 'fortinet', 'dell', 'sonicwall', 'paloalto', 'microsoft', 'hpe', 'ubiquiti'];
const advs = [];
for (let i = 0; i < 4000; i++) {
  const v = pick(keys, i);
  advs.push({ id: 'CVE-X-' + i, vendor: v, products: [pick(['Meraki MX', 'IOS XE Software', 'FortiOS', 'iDRAC9', 'SonicOS', 'PAN-OS', 'Windows', 'ArubaOS', 'UniFi Network Application', 'Wireless LAN Controller'], i)],
    affected: [{ product: pick(['Meraki MX', 'IOS XE Software', 'FortiOS', 'iDRAC9', 'SonicOS', 'PAN-OS', 'Windows', 'ArubaOS', 'UniFi Network Application', 'Wireless LAN Controller'], i), versions: [{ from: '7.0.0', to_excl: '7.0.14' }, { from: '17.0', to_excl: '17.12.1' }] }] });
}
t = Date.now();
let hits = 0;
for (const a of advs) if (V.matchAdvisory(a, inv.devices, vmap).confidence) hits++;
console.log('advisories', advs.length, 'matched', hits, 'match ms', Date.now() - t);
