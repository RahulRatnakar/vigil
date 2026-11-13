import os, sys, tempfile, unittest

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.dirname(HERE))
from vigil_collect import load_prev  # noqa: E402


class TestLoadPrev(unittest.TestCase):
    def test_missing_or_garbage_starts_fresh(self):
        d = tempfile.mkdtemp()
        self.assertEqual(load_prev(os.path.join(d, 'nope.json')), {})
        for junk in ('<html>404</html>', '[1,2]', ''):
            p = os.path.join(d, 'bad.json')
            open(p, 'w').write(junk)
            self.assertEqual(load_prev(p), {}, junk)

    def test_good_file_loads(self):
        p = os.path.join(tempfile.mkdtemp(), 'ok.json')
        open(p, 'w').write('{"last_run": "2026-11-13T12:00:00Z", "advisories": []}')
        self.assertEqual(load_prev(p)['last_run'], '2026-11-13T12:00:00Z')


if __name__ == '__main__':
    unittest.main()
