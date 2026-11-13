"""Optional Teams alert. Ships OFF: posts only when secret VIGIL_TEAMS_URL and variable VIGIL_TEAMS=on both exist.
Messages are vendor-level only: no client or device data ever exists on this side."""
import json, os, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
NEW = os.path.join(HERE, '..', 'site', 'data', '.new.json')


def is_alert(a, cvss_min=9.0):
    return bool(a.get('vendor')) and (bool(a.get('kev')) or (a.get('cvss') or 0) >= cvss_min)


def card(items, vmap):
    label = lambda k: vmap['vendors'].get(k, {}).get('label', k)
    body = [{'type': 'TextBlock', 'size': 'Large', 'weight': 'Bolder', 'text': f'VIGIL: {len(items)} new advisory alert(s)'}]
    for a in items[:10]:
        tag = 'EXPLOITED' if a.get('kev') else f'CVSS {a.get("cvss")}'
        body.append({'type': 'TextBlock', 'wrap': True, 'text': f'**{a["id"]}** · {label(a["vendor"])} · {tag}\n\n{a.get("title", "")[:160]}'})
    if len(items) > 10:
        body.append({'type': 'TextBlock', 'text': f'…and {len(items) - 10} more on the dashboard'})
    actions = [{'type': 'Action.OpenUrl', 'title': 'Open advisory', 'url': items[0]['urls'][0]}] if items[0].get('urls') else []
    return {'type': 'message', 'attachments': [{'contentType': 'application/vnd.microsoft.card.adaptive', 'content': {
        '$schema': 'http://adaptivecards.io/schemas/adaptive-card.json', 'type': 'AdaptiveCard', 'version': '1.4',
        'body': body, 'actions': actions}}]}


def notify(new_advisories, env, post, vmap=None):
    url = env.get('VIGIL_TEAMS_URL')
    if not url or env.get('VIGIL_TEAMS', '').lower() != 'on':
        return 0
    if vmap is None:
        vmap = json.load(open(os.path.join(HERE, 'vendors.json'), encoding='utf-8'))
    hits = [a for a in new_advisories if is_alert(a)]
    if hits:
        post(url, card(hits, vmap))
    return len(hits)


def http_post(url, payload):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
    urllib.request.urlopen(req, timeout=30).read()


if __name__ == '__main__':
    new = json.load(open(NEW, encoding='utf-8')) if os.path.exists(NEW) else []
    try:
        print(f'teams: {notify(new, os.environ, http_post)} posted')
    except Exception as e:          # a Teams problem must never fail the run
        print(f'teams: failed: {e}')
    sys.exit(0)
