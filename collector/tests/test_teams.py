import json, os, sys, unittest

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.dirname(HERE))
from teams import notify  # noqa: E402

VMAP = json.load(open(os.path.join(HERE, '..', 'vendors.json'), encoding='utf-8'))


def adv(cid, vendor='fortinet', kev=False, cvss=5.0):
    return {'id': cid, 'title': 'FortiOS heap overflow', 'vendor': vendor, 'products': ['FortiOS'], 'kev': kev, 'cvss': cvss,
            'severity': None, 'urls': [f'https://nvd.nist.gov/vuln/detail/{cid}']}


ON = {'VIGIL_TEAMS_URL': 'https://teams.test/hook', 'VIGIL_TEAMS': 'on'}


class TestTeams(unittest.TestCase):
    def test_disabled_by_default(self):
        calls = []
        self.assertEqual(notify([adv('CVE-2026-1', kev=True)], {}, lambda u, p: calls.append(p), VMAP), 0)
        self.assertEqual(calls, [])

    def test_needs_both_switches(self):
        calls = []
        notify([adv('CVE-2026-1', kev=True)], {'VIGIL_TEAMS_URL': 'https://teams.test/hook'}, lambda u, p: calls.append(p), VMAP)
        self.assertEqual(calls, [])

    def test_enabled_posts_vendor_level(self):
        calls = []
        n = notify([adv('CVE-2026-1', kev=True), adv('CVE-2026-2', cvss=5.0), adv('CVE-2026-3', vendor=None, kev=True)],
                   ON, lambda u, p: calls.append((u, p)), VMAP)
        self.assertEqual(n, 1)                      # only ours and (KEV or cvss >= 9)
        url, payload = calls[0]
        self.assertEqual(url, ON['VIGIL_TEAMS_URL'])
        text = json.dumps(payload)
        self.assertIn('CVE-2026-1', text)
        self.assertIn('Fortinet', text)
        for word in ('"client', '"device', '"ip"'):
            self.assertNotIn(word, text.lower())


if __name__ == '__main__':
    unittest.main()
