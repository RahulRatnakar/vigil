import json, os, sys, unittest

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.dirname(HERE))
from vendors import merge_watch, normalize_vendor, vendor_for_cve  # noqa: E402


def base():
    return json.load(open(os.path.join(HERE, '..', 'vendors.json'), encoding='utf-8'))


class TestWatchList(unittest.TestCase):
    def test_new_vendor_is_collected_and_matched(self):
        vmap = merge_watch(base(), {'vendors': {'Citrix': ['NetScaler', 'Cloud Software Group']}})
        self.assertEqual(vendor_for_cve('Citrix', vmap), 'citrix')
        self.assertEqual(vendor_for_cve('NetScaler', vmap), 'citrix')
        self.assertEqual(normalize_vendor('Citrix Systems, Inc.', vmap), 'citrix')
        self.assertEqual(vmap['vendors']['citrix']['label'], 'Citrix')
        self.assertTrue(vmap['vendors']['citrix']['watch'])

    def test_existing_vendor_gains_names(self):
        vmap = merge_watch(base(), {'vendors': {'Fortinet': ['Fortinet Federal']}})
        self.assertEqual(vendor_for_cve('Fortinet Federal', vmap), 'fortinet')
        self.assertEqual(vendor_for_cve('Fortinet', vmap), 'fortinet')

    def test_empty_or_broken_watch_changes_nothing(self):
        for w in (None, {}, {'vendors': []}, {'vendors': {'': ['x']}}, 'garbage'):
            self.assertEqual(sorted(merge_watch(base(), w)['vendors']), sorted(base()['vendors']), w)

    def test_shipped_watch_file_is_valid_and_has_citrix(self):
        w = json.load(open(os.path.join(HERE, '..', 'watch.json'), encoding='utf-8'))
        self.assertEqual(vendor_for_cve('NetScaler', merge_watch(base(), w)), 'citrix')


if __name__ == '__main__':
    unittest.main()
