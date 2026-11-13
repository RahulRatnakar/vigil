"""One function per advisory source. Each takes the run context and returns partial advisories:
dicts with at least `id`, plus any of the fields in vigil_collect.blank(). Public data only."""
import json, re
import xml.etree.ElementTree as ET
from datetime import timedelta
from email.utils import parsedate_to_datetime
from urllib.parse import quote

from vendors import vendor_for_cve

KEV_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json'
DELTA_URL = 'https://raw.githubusercontent.com/CVEProject/cvelistV5/main/cves/deltaLog.json'
NVD_URL = 'https://services.nvd.nist.gov/rest/json/cves/2.0'
EPSS_URL = 'https://api.first.org/data/v1/epss'
PAN_URL = 'https://security.paloaltonetworks.com/json/'
RSS = {'fortinet': 'https://www.fortiguard.com/rss/ir.xml',
       'cisco': 'https://sec.cloudapps.cisco.com/security/center/psirtrss20/CiscoSecurityAdvisory.xml',
       'microsoft': 'https://api.msrc.microsoft.com/update-guide/rss',
       'sophos': 'https://www.sophos.com/en-us/security-advisories/feed'}
CVE_RE = re.compile(r'CVE-\d{4}-\d{4,7}')


def _json(ctx, url):
    return json.loads(ctx['fetch'](url).decode('utf-8-sig'))


def kev(ctx):
    out = []
    for v in _json(ctx, KEV_URL).get('vulnerabilities', []):
        cid = v.get('cveID')
        if not cid:
            continue
        ctx['kev_ids'].add(cid)
        when = ctx['parse'](v.get('dateAdded'))
        out.append({'id': cid, 'title': v.get('vulnerabilityName', ''), 'vendor': vendor_for_cve(v.get('vendorProject'), ctx['vmap']),
                    'products': [v['product']] if v.get('product') else [], 'kev': True, 'published': when, 'modified': when,
                    'urls': [f'https://nvd.nist.gov/vuln/detail/{cid}'], 'sources': ['kev']})
    return out


def _versions(vs):
    out = []
    for v in vs or []:
        if v.get('status', 'affected') != 'affected':
            continue
        start = v.get('version')
        start = None if str(start).strip().lower() in ('0', '*', 'n/a', '', 'none', 'unspecified') else start
        lt, lte = v.get('lessThan'), v.get('lessThanOrEqual')
        if lt in ('*',):
            lt = None
        if not lt and not lte and start:
            lte = start                       # a single named version
        out.append({'from': start, 'to_excl': lt, 'to_incl': lte})
    return out


def _max_cvss(metric_lists):
    best = None
    for ms in metric_lists:
        for m in ms or []:
            for k, v in m.items():
                if k.lower().startswith('cvss') and isinstance(v, dict) and v.get('baseScore') is not None:
                    best = max(best or 0, float(v['baseScore']))
    return best


def parse_cve_record(rec, ctx):
    meta, cont = rec.get('cveMetadata', {}), rec.get('containers', {})
    cid = meta.get('cveId')
    if meta.get('state') == 'REJECTED':
        return {'id': cid, '_rejected': True}
    cna = cont.get('cna', {})
    vendor, products, affected = None, [], []
    for a in cna.get('affected', []):
        vendor = vendor or vendor_for_cve(a.get('vendor'), ctx['vmap'])
        if a.get('product'):
            products.append(a['product'])
            affected.append({'product': a['product'], 'versions': _versions(a.get('versions'))})
    desc = next((d.get('value', '') for d in cna.get('descriptions', []) if d.get('lang', 'en').startswith('en')), '')
    return {'id': cid, 'title': cna.get('title') or desc[:160], 'vendor': vendor, 'products': products, 'affected': affected,
            'cvss': _max_cvss([cna.get('metrics')] + [a.get('metrics') for a in cont.get('adp', [])]),
            'published': ctx['parse'](meta.get('datePublished')), 'modified': ctx['parse'](meta.get('dateUpdated')),
            'urls': [r['url'] for r in cna.get('references', [])[:5] if r.get('url')], 'sources': ['cvelist']}


def cvelist(ctx):
    # fast path: only the last few hours of changes (NVD back-fills anything older)
    since = max(ctx['last'] - timedelta(minutes=15) if ctx['last'] else ctx['now'] - timedelta(hours=6), ctx['now'] - timedelta(hours=6))
    links = {}
    for entry in _json(ctx, DELTA_URL):
        if ctx['parse_dt'](entry.get('fetchTime')) < since:
            continue
        for item in (entry.get('new') or []) + (entry.get('updated') or []):
            links.setdefault(item['cveId'], item['githubLink'])
    out = []
    for cid, link in list(links.items())[:1500]:
        try:
            out.append(parse_cve_record(_json(ctx, link), ctx))
        except Exception:
            continue                      # one bad record doesn't stop the rest
    return out


def _cpe_parts(criteria):
    p = criteria.split(':')
    return (p[3], p[4].replace('_', ' '), p[5]) if len(p) > 5 else (None, None, None)


def parse_nvd_item(item, ctx):
    c = item.get('cve', {})
    cid = c.get('id')
    if c.get('vulnStatus') == 'Rejected':
        return {'id': cid, '_rejected': True}
    vendor, products, affected = None, [], []
    for conf in c.get('configurations', []):
        for node in conf.get('nodes', []):
            for m in node.get('cpeMatch', []):
                if not m.get('vulnerable'):
                    continue
                cv, prod, ver = _cpe_parts(m.get('criteria', ''))
                vendor = vendor or vendor_for_cve(cv, ctx['vmap'])
                v = {'from': m.get('versionStartIncluding'), 'to_excl': m.get('versionEndExcluding'), 'to_incl': m.get('versionEndIncluding')}
                if not any(v.values()) and ver not in (None, '*', '-'):
                    v = {'from': ver, 'to_excl': None, 'to_incl': ver}
                if prod and prod not in products:
                    products.append(prod)
                affected.append({'product': prod, 'versions': [v]})
    if not vendor:
        dom = (c.get('sourceIdentifier') or '').split('@')[-1].split('.')
        vendor = vendor_for_cve(dom[-2] if len(dom) >= 2 else '', ctx['vmap'])
    desc = next((d['value'] for d in c.get('descriptions', []) if d.get('lang') == 'en'), '')
    mets = c.get('metrics', {})
    cvss = None
    for k, ms in mets.items():
        for m in ms:
            s = (m.get('cvssData') or {}).get('baseScore')
            if k.startswith('cvssMetric') and s is not None:
                cvss = max(cvss or 0, float(s))
    return {'id': cid, 'title': desc[:160], 'vendor': vendor, 'products': products, 'affected': affected, 'cvss': cvss,
            'published': ctx['parse'](c.get('published')), 'modified': ctx['parse'](c.get('lastModified')),
            'urls': [r['url'] for r in c.get('references', [])[:5] if r.get('url')], 'sources': ['nvd']}


def nvd(ctx):
    now = ctx['now']
    start = now - timedelta(days=90) if not ctx['last'] else max(ctx['last'] - timedelta(minutes=15), now - timedelta(days=7))
    fmt = lambda d: quote(d.strftime('%Y-%m-%dT%H:%M:%S.000') + '+00:00', safe=':.')
    out, index, total, pages = [], 0, 1, 0
    # NVD allows 120-day windows; 90 days fits in one window
    while index < total and pages < 60:
        if pages:
            ctx['sleep'](ctx['nvd_delay'])
        page = _json(ctx, f'{NVD_URL}?lastModStartDate={fmt(start)}&lastModEndDate={fmt(now)}&startIndex={index}&resultsPerPage=2000')
        total = page.get('totalResults', 0)
        items = page.get('vulnerabilities', [])
        out += [parse_nvd_item(i, ctx) for i in items]
        index += len(items) or total
        pages += 1
    return out


def _rss(ctx, key, url):
    out = []
    root = ET.fromstring(ctx['fetch'](url).decode('utf-8-sig').encode('utf-8'))
    for it in root.iter('item'):
        g = lambda tag: (it.findtext(tag) or '').strip()
        title, link, desc = g('title'), g('link'), g('description')
        try:
            when = ctx['iso'](parsedate_to_datetime(g('pubDate')))
        except Exception:
            when = ctx['iso'](ctx['now'])
        ids = sorted(set(CVE_RE.findall(title + ' ' + desc))) or [f'{key.upper()}:{link.rstrip("/").split("/")[-1] or title[:40]}']
        for cid in ids:
            out.append({'id': cid, 'title': re.sub(r'\s+', ' ', title)[:160], 'vendor': key, 'published': when, 'modified': when,
                        'urls': [link] if link else [], 'sources': [key]})
    return out


def feed(key):
    return lambda ctx: _rss(ctx, key, RSS[key])


def paloalto(ctx):
    out = []
    for a in _json(ctx, PAN_URL):
        aid = a.get('ID')
        if not aid:
            continue
        when = ctx['parse'](a.get('date') or a.get('updated') or a.get('published')) or ctx['iso'](ctx['now'])
        out.append({'id': aid, 'title': a.get('title', ''), 'vendor': 'paloalto', 'products': a.get('product') or [],
                    'cvss': a.get('baseScore'), 'published': when, 'modified': when,
                    'urls': [f'https://security.paloaltonetworks.com/{aid}'], 'sources': ['paloalto']})
    return out


def epss(ctx):
    want = [a['id'] for a in ctx['adv'].values() if a.get('epss') is None and a['id'].startswith('CVE-') and (a.get('vendor') or a.get('kev'))][:300]
    out = []
    for i in range(0, len(want), 100):
        for d in _json(ctx, f'{EPSS_URL}?cve={",".join(want[i:i + 100])}').get('data', []):
            out.append({'id': d['cve'], 'epss': float(d['epss'])})
    return out


ORDER = [('kev', kev), ('cvelist', cvelist), ('nvd', nvd), ('fortinet', feed('fortinet')), ('cisco', feed('cisco')),
         ('paloalto', paloalto), ('microsoft', feed('microsoft')), ('sophos', feed('sophos')), ('epss', epss)]
