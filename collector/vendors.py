"""Vendor name normalisation, shared by the collector (CVE vendor strings) and mirrored in site/match.js (inventory spellings)."""
import re

# words that vary between spellings of the same company ("Cisco Systems, Inc" vs "Cisco")
_DROP = {'inc', 'corp', 'corporation', 'co', 'ltd', 'llc', 'limited', 'systems', 'networks', 'network',
         'technologies', 'technology', 'the', 'communications', 'wireless'}


def norm(raw):
    words = re.sub(r'[^a-z0-9]+', ' ', str(raw or '').lower()).split()
    kept = [w for w in words if w not in _DROP]
    return ' '.join(kept or words)


def _index(vmap, field):
    idx = vmap.get('_idx_' + field)
    if idx is None:
        idx = {norm(a): key for key, v in vmap['vendors'].items() for a in v[field]}
        vmap['_idx_' + field] = idx
    return idx


def is_ignored(raw, vmap):
    return norm(raw) in {norm(x) for x in vmap.get('ignore', [])}


def normalize_vendor(raw, vmap):
    """Inventory Manufacturer spelling -> vendor key, or None for junk/unknown."""
    n = norm(raw)
    if not n or is_ignored(raw, vmap):
        return None
    return _index(vmap, 'aliases').get(n)


def vendor_for_cve(raw, vmap):
    """Vendor string from a CVE record -> vendor key, or None when it isn't one of ours."""
    n = norm(raw)
    if not n:
        return None
    idx = _index(vmap, 'cve_names')
    if n in idx:
        return idx[n]
    # "Hewlett Packard Enterprise (HPE)" -> try the longest known prefix
    for name in sorted(idx, key=len, reverse=True):
        if n.startswith(name + ' '):
            return idx[name]
    return None
