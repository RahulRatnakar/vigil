import json, os, sys, unittest
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.dirname(HERE))
from vigil_collect import run  # noqa: E402

VMAP = json.load(open(os.path.join(HERE, '..', 'vendors.json'), encoding='utf-8'))
NOW = datetime(2026, 11, 13, 12, 0, tzinfo=timezone.utc)
iso = lambda d: d.strftime('%Y-%m-%dT%H:%M:%S.000Z')


def cve_record(cid, vendor='Fortinet', product='FortiOS', score=9.8, state='PUBLISHED', published=NOW - timedelta(hours=1)):
    return {'cveMetadata': {'cveId': cid, 'state': state, 'datePublished': iso(published), 'dateUpdated': iso(published)},
            'containers': {'cna': {'title': f'{product} heap overflow',
                                   'affected': [{'vendor': vendor, 'product': product, 'versions': [{'status': 'affected', 'version': '7.0.0', 'lessThan': '7.0.14', 'versionType': 'semver'}]}],
                                   'metrics': [{'cvssV3_1': {'baseScore': score}}],
                                   'references': [{'url': f'https://example.test/{cid}'}]}}}


def delta(*cids, when=NOW - timedelta(minutes=20)):
    return [{'fetchTime': iso(when), 'new': [{'cveId': c, 'githubLink': f'https://raw.test/{c}.json'} for c in cids], 'updated': [], 'error': []}]


def nvd_page(items=()):
    return {'resultsPerPage': len(items), 'startIndex': 0, 'totalResults': len(items), 'vulnerabilities': list(items)}


def kev(*entries):
    return {'vulnerabilities': [{'cveID': c, 'vendorProject': v, 'product': p, 'vulnerabilityName': f'{v} {p} vuln', 'dateAdded': d} for c, v, p, d in entries]}


class Fetcher:
    """Answers each source URL from a dict of {url-substring: payload}; raises for substrings listed in fail."""
    def __init__(self, routes, fail=()):
        self.routes, self.fail, self.urls = routes, fail, []

    def __call__(self, url):
        self.urls.append(url)
        for key in self.fail:
            if key in url:
                raise OSError(f'boom: {key}')
        for key, payload in self.routes.items():
            if key in url:
                return payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        return b'<rss><channel></channel></rss>' if ('rss' in url or url.endswith('.xml')) else b'[]'


def base_routes(**extra):
    r = {'known_exploited': kev(), 'deltaLog': [], 'services.nvd.nist.gov': nvd_page(), 'api.first.org': {'data': []},
         'security.paloaltonetworks.com/json': [], 'psirtapi.global.sonicwall.com': []}
    r.update(extra)
    return r


def snwl(aid, cve=None, cvss='9.1', impact='critical', when=NOW - timedelta(hours=2), title='SonicOS SSLVPN improper access control'):
    return {'advisory_id': aid, 'title': title, 'published_when': iso(when), 'last_updated_when': iso(when), 'impact': impact,
            'cvss': cvss, 'cve': cve, 'summary': '<p>Upgrade to <b>SonicOS 7.1.3-7015</b> or later.</p>', 'vulnerable_products': 'SonicOS'}


class TestSonicWall(unittest.TestCase):
    def test_snwlid_lands_on_each_cve(self):
        f = Fetcher(base_routes(**{'psirtapi.global.sonicwall.com': [snwl('SNWLID-2026-0019', cve='CVE-2026-1001, CVE-2026-1002')]}))
        by = {a['id']: a for a in run(NOW, {}, f, VMAP)['advisories']}
        for cid in ('CVE-2026-1001', 'CVE-2026-1002'):
            a = by[cid]
            self.assertEqual(a['vendor'], 'sonicwall')
            self.assertIn('SNWLID-2026-0019', a['refs'])
            self.assertIn('sonicwall', a['sources'])
            self.assertEqual(a['cvss'], 9.1)
            self.assertIn('https://psirt.global.sonicwall.com/vuln-detail/SNWLID-2026-0019', a['urls'])

    def test_snwlid_without_cve_is_its_own_advisory(self):
        f = Fetcher(base_routes(**{'psirtapi.global.sonicwall.com': [snwl('SNWLID-2026-0021', cve=None, cvss=None, impact='not_defined', title='Informational Advisory: DPI-SSL')]}))
        by = {a['id']: a for a in run(NOW, {}, f, VMAP)['advisories']}
        a = by['SNWLID-2026-0021']
        self.assertEqual(a['vendor'], 'sonicwall')
        self.assertEqual(a['refs'], ['SNWLID-2026-0021'])
        self.assertIsNone(a['cvss'])

    def test_snwlid_merges_with_cve_list_record(self):
        f = Fetcher(base_routes(**{'deltaLog': delta('CVE-2026-1001'), 'CVE-2026-1001.json': cve_record('CVE-2026-1001', vendor='SonicWall', product='SonicOS'),
                                   'psirtapi.global.sonicwall.com': [snwl('SNWLID-2026-0019', cve='CVE-2026-1001')]}))
        hits = [a for a in run(NOW, {}, f, VMAP)['advisories'] if a['id'] == 'CVE-2026-1001']
        self.assertEqual(len(hits), 1)
        self.assertTrue({'cvelist', 'sonicwall'} <= set(hits[0]['sources']))
        self.assertIn('SNWLID-2026-0019', hits[0]['refs'])

    def test_old_snwlid_not_kept(self):
        f = Fetcher(base_routes(**{'psirtapi.global.sonicwall.com': [snwl('SNWLID-2025-0001', cve='CVE-2025-1', when=NOW - timedelta(days=200))]}))
        self.assertNotIn('CVE-2025-1', {a['id'] for a in run(NOW, {}, f, VMAP)['advisories']})

    def test_refs_field_always_present(self):
        out = run(NOW, {}, Fetcher(base_routes(**{'deltaLog': delta('CVE-2026-7777'), 'CVE-2026-7777.json': cve_record('CVE-2026-7777')})), VMAP)
        self.assertEqual([a['refs'] for a in out['advisories'] if a['id'] == 'CVE-2026-7777'], [[]])


class TestCollector(unittest.TestCase):
    def test_merge_same_cve(self):
        cid = 'CVE-2026-1111'
        rss = (f'<rss><channel><item><title>FortiOS heap overflow ({cid})</title><link>https://fortiguard.test/FG-IR-26-1</link>'
               f'<description>{cid}</description><pubDate>Fri, 13 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>').encode()
        f = Fetcher(base_routes(**{'known_exploited': kev((cid, 'Fortinet', 'FortiOS', '2026-11-13')), 'deltaLog': delta(cid),
                                   f'{cid}.json': cve_record(cid), 'fortiguard.com/rss': rss}))
        out = run(NOW, {}, f, VMAP)
        hits = [a for a in out['advisories'] if a['id'] == cid]
        self.assertEqual(len(hits), 1)
        self.assertTrue(hits[0]['kev'])
        self.assertTrue({'kev', 'cvelist', 'fortinet'} <= set(hits[0]['sources']))
        self.assertEqual(hits[0]['vendor'], 'fortinet')

    def test_source_failure_keeps_old(self):
        old = {'id': 'CVE-2026-2222', 'title': 'old', 'vendor': 'cisco', 'products': [], 'affected': [], 'cvss': 9.1, 'severity': 'critical',
               'kev': False, 'epss': None, 'published': iso(NOW - timedelta(days=2)), 'modified': iso(NOW - timedelta(days=2)), 'urls': [], 'sources': ['nvd']}
        prev = {'last_run': iso(NOW - timedelta(minutes=15)), 'sources': {}, 'advisories': [old]}
        out = run(NOW, prev, Fetcher(base_routes(), fail=['services.nvd.nist.gov']), VMAP, sleep=lambda s: None)
        self.assertEqual(out['sources']['nvd']['status'], 'stale')
        self.assertTrue(out['sources']['nvd']['error'])
        kept = [a for a in out['advisories'] if a['id'] == 'CVE-2026-2222']
        self.assertEqual(kept[0]['cvss'], 9.1)
        self.assertEqual(out['sources']['kev']['status'], 'ok')

    def test_retention_90_days(self):
        mk = lambda cid, days: {'id': cid, 'title': '', 'vendor': 'dell', 'products': [], 'affected': [], 'cvss': 5.0, 'severity': 'medium', 'kev': False,
                                'epss': None, 'published': iso(NOW - timedelta(days=days)), 'modified': iso(NOW - timedelta(days=days)), 'urls': [], 'sources': ['nvd']}
        prev = {'last_run': iso(NOW - timedelta(minutes=15)), 'advisories': [mk('CVE-OLD-91', 91), mk('CVE-OK-89', 89)]}
        ids = {a['id'] for a in run(NOW, prev, Fetcher(base_routes()), VMAP)['advisories']}
        self.assertNotIn('CVE-OLD-91', ids)
        self.assertIn('CVE-OK-89', ids)

    def test_incremental_window(self):
        f = Fetcher(base_routes())
        run(NOW, {'last_run': iso(NOW - timedelta(days=30)), 'advisories': []}, f, VMAP)
        nvd = [u for u in f.urls if 'services.nvd.nist.gov' in u]
        self.assertTrue(nvd)
        self.assertIn('lastModStartDate=' + (NOW - timedelta(days=7)).strftime('%Y-%m-%dT%H:%M'), nvd[0])

    def test_first_run_backfills_90_days(self):
        f = Fetcher(base_routes())
        run(NOW, {}, f, VMAP)
        nvd = [u for u in f.urls if 'services.nvd.nist.gov' in u]
        self.assertIn('lastModStartDate=' + (NOW - timedelta(days=90)).strftime('%Y-%m-%dT%H:%M'), nvd[0])

    def test_vendor_tagging(self):
        f = Fetcher(base_routes(**{'deltaLog': delta('CVE-2026-3333', 'CVE-2026-4444'),
                                   'CVE-2026-3333.json': cve_record('CVE-2026-3333', vendor='Fortinet'),
                                   'CVE-2026-4444.json': cve_record('CVE-2026-4444', vendor='Acme Toasters'),
                                   'known_exploited': kev(('CVE-2026-5555', 'Acme Toasters', 'Toaster OS', '2026-11-12'))}))
        by = {a['id']: a for a in run(NOW, {}, f, VMAP)['advisories']}
        self.assertEqual(by['CVE-2026-3333']['vendor'], 'fortinet')
        self.assertNotIn('CVE-2026-4444', by)          # not one of ours and not exploited: dropped
        self.assertIsNone(by['CVE-2026-5555']['vendor'])  # exploited is always kept, even for other vendors
        self.assertTrue(by['CVE-2026-5555']['kev'])

    def test_rejected_cve_removed(self):
        prev = {'last_run': iso(NOW - timedelta(minutes=15)), 'advisories': [{'id': 'CVE-2026-6666', 'title': 'x', 'vendor': 'fortinet', 'products': [], 'affected': [],
                'cvss': 7.0, 'severity': 'high', 'kev': False, 'epss': None, 'published': iso(NOW - timedelta(days=1)), 'modified': iso(NOW - timedelta(days=1)), 'urls': [], 'sources': ['cvelist']}]}
        f = Fetcher(base_routes(**{'deltaLog': delta('CVE-2026-6666'), 'CVE-2026-6666.json': cve_record('CVE-2026-6666', state='REJECTED')}))
        self.assertNotIn('CVE-2026-6666', {a['id'] for a in run(NOW, prev, f, VMAP)['advisories']})

    def test_no_private_fields(self):
        f = Fetcher(base_routes(**{'deltaLog': delta('CVE-2026-7777'), 'CVE-2026-7777.json': cve_record('CVE-2026-7777')}))
        text = json.dumps(run(NOW, {}, f, VMAP)).lower()
        for key in ('"client"', '"device"', '"ip"', '"serial"'):
            self.assertNotIn(key, text)

    def test_vendor_solution_text_is_kept(self):
        rec = cve_record('CVE-2026-8888')
        rec['containers']['cna']['solutions'] = [{'lang': 'en', 'value': 'Upgrade to FortiOS 7.0.14 or above.\nOther notes.'}]
        rec['containers']['cna']['workarounds'] = [{'lang': 'en', 'value': 'Disable SSL-VPN.'}]
        f = Fetcher(base_routes(**{'deltaLog': delta('CVE-2026-8888'), 'CVE-2026-8888.json': rec}))
        a = [x for x in run(NOW, {}, f, VMAP)['advisories'] if x['id'] == 'CVE-2026-8888'][0]
        self.assertTrue(a['fix'].startswith('Upgrade to FortiOS 7.0.14 or above.'))
        self.assertLessEqual(len(a['fix']), 400)
        self.assertEqual(a['workaround'], 'Disable SSL-VPN.')

    def test_fix_fields_exist_without_solution(self):
        f = Fetcher(base_routes(**{'deltaLog': delta('CVE-2026-8889'), 'CVE-2026-8889.json': cve_record('CVE-2026-8889')}))
        a = [x for x in run(NOW, {}, f, VMAP)['advisories'] if x['id'] == 'CVE-2026-8889'][0]
        self.assertIsNone(a['fix'])
        self.assertIsNone(a['workaround'])


class TestNvdCursor(unittest.TestCase):
    """NVD keeps its own 'last success' so a failed first back-fill is retried instead of shrinking to 7 days."""
    NO_SLEEP = staticmethod(lambda s: None)

    def nvd_start(self, prev, fetcher=None):
        f = fetcher or Fetcher(base_routes())
        out = run(NOW, prev, f, VMAP, sleep=self.NO_SLEEP)
        return [u for u in f.urls if 'services.nvd.nist.gov' in u][0], out

    def test_backfill_repeats_until_nvd_first_succeeds(self):
        prev = {'last_run': iso(NOW - timedelta(minutes=15)), 'advisories': [],
                'sources': {'nvd': {'status': 'stale', 'checked': iso(NOW - timedelta(minutes=15)), 'error': 'TimeoutError'}}}
        url, _ = self.nvd_start(prev)
        self.assertIn('lastModStartDate=' + (NOW - timedelta(days=90)).strftime('%Y-%m-%dT%H:%M'), url)

    def test_window_starts_at_last_success(self):
        ok = NOW - timedelta(hours=1)
        prev = {'last_run': iso(NOW - timedelta(minutes=15)), 'advisories': [],
                'sources': {'nvd': {'status': 'ok', 'checked': iso(ok), 'error': None, 'last_ok': iso(ok)}}}
        url, out = self.nvd_start(prev)
        self.assertIn('lastModStartDate=' + (ok - timedelta(minutes=15)).strftime('%Y-%m-%dT%H:%M'), url)
        self.assertTrue(out['sources']['nvd']['last_ok'].startswith(NOW.strftime('%Y-%m-%dT%H:%M')))

    def test_failure_keeps_last_success(self):
        ok = iso(NOW - timedelta(hours=1))
        prev = {'last_run': iso(NOW - timedelta(minutes=15)), 'advisories': [],
                'sources': {'nvd': {'status': 'ok', 'checked': ok, 'error': None, 'last_ok': ok}}}
        out = run(NOW, prev, Fetcher(base_routes(), fail=['services.nvd.nist.gov']), VMAP, sleep=self.NO_SLEEP)
        self.assertEqual(out['sources']['nvd']['status'], 'stale')
        self.assertEqual(out['sources']['nvd']['last_ok'], ok)

    def test_slow_nvd_is_retried(self):
        calls = {'n': 0}
        inner = Fetcher(base_routes())

        def flaky(url):
            if 'services.nvd.nist.gov' in url:
                calls['n'] += 1
                if calls['n'] <= 2:
                    raise TimeoutError('The read operation timed out')
            return inner(url)
        out = run(NOW, {}, flaky, VMAP, sleep=self.NO_SLEEP)
        self.assertEqual(out['sources']['nvd']['status'], 'ok')
        self.assertEqual(calls['n'], 3)


if __name__ == '__main__':
    unittest.main()
