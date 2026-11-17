import json, os, sys, unittest

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.dirname(HERE))
from vendors import normalize_vendor, vendor_for_cve  # noqa: E402

VMAP = json.load(open(os.path.join(HERE, '..', 'vendors.json'), encoding='utf-8'))


class TestVendorAliases(unittest.TestCase):
    def test_vendor_aliases(self):
        cases = {'Fortigate': 'fortinet', 'Fortinet': 'fortinet', 'Cisco Systems, Inc': 'cisco', 'Meraki': 'cisco',
                 'Ubiquiti Networks': 'ubiquiti', 'Dell Inc.': 'dell', 'VMware VCO': 'vmware'}
        for raw, key in cases.items():
            self.assertEqual(normalize_vendor(raw, VMAP), key, raw)

    def test_junk_values_are_none(self):
        for raw in ['0', '#N/A', 'Server', '', 'Unmanaged', None]:
            self.assertIsNone(normalize_vendor(raw, VMAP), raw)

    def test_every_inventory_spelling_is_known(self):
        # all 70 spellings in the Q4 inventory are either mapped or deliberately ignored, so nothing is silently lost
        spellings = ['Meraki', 'VMware VCO', 'HPE', 'Cisco Systems, Inc', 'Ubiquiti Networks', '0', 'Server', 'Fortigate', 'Dell',
            'Ruckus Wireless, Inc.', 'Juniper Networks', 'SonicWall, Inc.', 'Palo Alto Networks, Inc.', 'Netgear', 'UPS', 'APC', 'Engenius',
            'Synology', 'ADTRAN, Inc.', 'Watchguard', 'Araknis Networks', 'VOW IVR', '#N/A', 'LENOVO', 'Nimble', 'Extreme Networks', 'Vmware',
            'Supermicro', 'Dell Inc.', 'Sophos', 'EnGenius', 'Fortinet', 'Lenovo', 'QNAP Systems, Inc.', 'Microsoft Corporation',
            'Broadcom Corporation', 'ISP', 'Microsoft', 'Unmanaged', 'HPE ANW', 'Brocade Communication', 'H3C', 'VMware, Inc.',
            'Phone system', 'MikroTik', 'VoIP', 'Aerochive', 'HP', 'Red Hat', 'StandaloneESXi', 'NVIDIA',
            'Hewlett-Packard', 'Aruba', 'Arista Networks', 'ASUS', 'EVO tool', 'Sonicwall', 'Eaton', 'Phybridge', 'OpenStack Foundation',
            'NetApp', 'QEMU', 'Huawei', 'Unitrends', 'Buffalo', 'Acer', 'Vmware VCO', 'Pure Storage']
        from vendors import is_ignored
        unknown = [s for s in spellings if normalize_vendor(s, VMAP) is None and not is_ignored(s, VMAP)]
        self.assertEqual(unknown, [])

    def test_cve_vendor_strings(self):
        self.assertEqual(vendor_for_cve('Fortinet', VMAP), 'fortinet')
        self.assertEqual(vendor_for_cve('Palo Alto Networks', VMAP), 'paloalto')
        self.assertEqual(vendor_for_cve('Hewlett Packard Enterprise (HPE)', VMAP), 'hpe')
        self.assertEqual(vendor_for_cve('Juniper Networks', VMAP), 'juniper')
        self.assertIsNone(vendor_for_cve('Some Unrelated Vendor', VMAP))


if __name__ == '__main__':
    unittest.main()
