"""VIGIL collector: gathers public advisories for our vendors into site/data/advisories.json.
Runs on GitHub Actions every 15 minutes. Holds public data only: never client or device data."""
import argparse, json, os, sys, time, urllib.request
from datetime import datetime, timedelta, timezone

import sources
from vendors import load_vmap

RETAIN_DAYS = 90
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'site', 'data', 'advisories.json')


def iso(d):
    return d.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def parse_dt(s):
    if not s:
        return None
    s = str(s).strip().replace('Z', '+00:00')
    d = datetime.fromisoformat(s if 'T' in s else s + 'T00:00:00+00:00')
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def severity(score):
    if score is None:
        return None
    return 'critical' if score >= 9 else 'high' if score >= 7 else 'medium' if score >= 4 else 'low'


def blank(aid):
    return {'id': aid, 'title': '', 'vendor': None, 'products': [], 'affected': [], 'cvss': None, 'severity': None, 'kev': False,
            'epss': None, 'published': None, 'modified': None, 'urls': [], 'sources': [], 'fix': None, 'workaround': None}


def merge(a, b):
    """Fold partial advisory b into a (or a fresh one). Same CVE from several sources becomes one entry."""
    a = dict(a) if a else blank(b['id'])
    a['title'] = a['title'] or b.get('title') or ''
    a['vendor'] = a['vendor'] or b.get('vendor')
    a['fix'] = a.get('fix') or b.get('fix')
    a['workaround'] = a.get('workaround') or b.get('workaround')
    for k in ('products', 'urls', 'sources'):
        a[k] = list(dict.fromkeys(a[k] + (b.get(k) or [])))
    a['urls'] = a['urls'][:8]
    if b.get('affected') and (not a['affected'] or 'cvelist' in (b.get('sources') or [])):
        a['affected'] = b['affected']
    scores = [s for s in (a['cvss'], b.get('cvss')) if s is not None]
    a['cvss'] = max(scores) if scores else None
    a['kev'] = bool(a['kev'] or b.get('kev'))
    if b.get('epss') is not None:
        a['epss'] = b['epss']
    dates = lambda k: [d for d in (a[k], b.get(k)) if d]
    a['published'] = min(dates('published')) if dates('published') else None
    a['modified'] = max(dates('modified')) if dates('modified') else a['published']
    return a


def run(now, prev, fetch, vmap, sleep=time.sleep, nvd_delay=6.0):
    prev = prev or {}
    adv = {a['id']: dict(a) for a in prev.get('advisories', [])}
    status = dict(prev.get('sources', {}))
    ctx = {'now': now, 'last': parse_dt(prev.get('last_run')), 'fetch': fetch, 'vmap': vmap, 'sleep': sleep, 'nvd_delay': nvd_delay,
           'kev_ids': set(), 'adv': adv, 'iso': iso, 'parse_dt': lambda s: parse_dt(s) or now,
           'parse': lambda s: iso(parse_dt(s)) if s else None}
    prev_src = prev.get('sources', {})

    def since(sid):
        """When this source last succeeded. Unknown history (older files) falls back to last_run."""
        if sid not in prev_src:
            return ctx['last']
        p = prev_src[sid]
        return parse_dt(p.get('last_ok') or (p.get('checked') if p.get('status') == 'ok' else None))
    ctx['since'] = since
    removed = set()
    for sid, fn in sources.ORDER:
        last_ok = (prev_src.get(sid) or {}).get('last_ok')
        try:
            parts = fn(ctx)
        except Exception as e:       # one broken source never stops the run; its old data stays
            status[sid] = {'status': 'stale', 'checked': iso(now), 'error': f'{type(e).__name__}: {e}'[:200], 'last_ok': last_ok}
            continue
        status[sid] = {'status': 'ok', 'checked': iso(now), 'error': None, 'last_ok': iso(now)}
        for p in parts:
            if not p.get('id'):
                continue
            if p.get('_rejected'):
                removed.add(p['id'])
                adv.pop(p['id'], None)
                continue
            if p['id'] not in removed:
                adv[p['id']] = merge(adv.get(p['id']), p)
    cutoff = iso(now - timedelta(days=RETAIN_DAYS))
    keep = []
    for a in adv.values():
        a['kev'] = a['kev'] or a['id'] in ctx['kev_ids']
        a['severity'] = severity(a['cvss'])
        a.setdefault('fix', None); a.setdefault('workaround', None)
        newest = max(d for d in (a.get('published'), a.get('modified'), cutoff) if d)
        # ours, or actively exploited anywhere; and touched within the retention window
        if (a['vendor'] or a['kev']) and newest > cutoff:
            keep.append(a)
    keep.sort(key=lambda a: a.get('modified') or '', reverse=True)
    return {'generated': iso(now), 'last_run': iso(now), 'sources': status, 'advisories': keep}


def http_fetch(url):
    headers = {'User-Agent': 'VIGIL-collector (github.com; public advisories)'}
    if 'nvd.nist.gov' in url and os.environ.get('NVD_API_KEY'):
        headers['apiKey'] = os.environ['NVD_API_KEY']
    timeout = 150 if 'nvd.nist.gov' in url else 60        # NVD pages can take over a minute
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=timeout) as r:
        return r.read()


def load_prev(path):
    """Previous run's output, or {} when it is missing or not a VIGIL file (then the run back-fills from scratch)."""
    try:
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        return data if isinstance(data, dict) and isinstance(data.get('advisories', []), list) else {}
    except (OSError, ValueError):
        return {}


def main(argv=None):
    ap = argparse.ArgumentParser(description='Collect public advisories for VIGIL')
    ap.add_argument('--dry-run', action='store_true', help='print a summary, write nothing')
    args = ap.parse_args(argv)
    vmap = load_vmap(HERE)
    prev = load_prev(OUT)
    out = run(datetime.now(timezone.utc), prev, http_fetch, vmap, nvd_delay=0.6 if os.environ.get('NVD_API_KEY') else 6.0)
    for sid, s in out['sources'].items():
        print(f'{sid:10} {s["status"]:5} {s["error"] or ""}')
    print(f'advisories: {len(out["advisories"])}  (ours: {sum(1 for a in out["advisories"] if a["vendor"])}, exploited: {sum(1 for a in out["advisories"] if a["kev"])})')
    if not args.dry_run:
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        with open(OUT, 'w', encoding='utf-8') as f:
            json.dump(out, f, separators=(',', ':'))
        # new advisories since the previous run, for the (disabled by default) Teams hook
        old = {a['id'] for a in prev.get('advisories', [])}
        with open(os.path.join(HERE, '..', 'site', 'data', '.new.json'), 'w', encoding='utf-8') as f:
            json.dump([a for a in out['advisories'] if a['id'] not in old], f)
        # the page merges the same watch list, so labels and inventory matching agree with the collector
        try:
            watch = json.load(open(os.path.join(HERE, 'watch.json'), encoding='utf-8'))
        except (OSError, ValueError):
            watch = {'vendors': {}}
        with open(os.path.join(HERE, '..', 'site', 'data', 'watch.json'), 'w', encoding='utf-8') as f:
            json.dump(watch, f)
    return 0


if __name__ == '__main__':
    sys.exit(main())
