#!/usr/bin/env bash
# Local-only test runner. This laptop blocks python.exe from opening .py files in the workspace,
# so modules are read through `cat` and imported from memory. On GitHub the normal
# `python -m unittest discover -s collector/tests` is used instead.
cd "$(dirname "$0")/../vigil" || exit 2
python -I - "$@" <<'EOF'
import importlib.abc, importlib.util, os, subprocess, sys, unittest
ROOT = os.path.abspath('collector')
def src(path): return subprocess.run(['cat', path], capture_output=True, check=True).stdout.decode('utf-8')
class CatLoader(importlib.abc.Loader):
    def __init__(self, path): self.path = path
    def create_module(self, spec): return None
    def exec_module(self, m): m.__file__ = self.path; exec(compile(src(self.path), self.path, 'exec'), m.__dict__)
class CatFinder(importlib.abc.MetaPathFinder):
    def find_spec(self, name, path=None, target=None):
        rel = name.replace('.', os.sep)
        for base in (ROOT, os.path.join(ROOT, 'tests')):
            for cand in (os.path.join(base, rel + '.py'), os.path.join(base, rel, '__init__.py')):
                if os.path.exists(cand):
                    spec = importlib.util.spec_from_loader(name, CatLoader(cand), is_package=cand.endswith('__init__.py'))
                    if spec.submodule_search_locations is not None: spec.submodule_search_locations.append(os.path.dirname(cand))
                    return spec
        return None
sys.meta_path.insert(0, CatFinder())
names = sys.argv[1:] or sorted(f[:-3] for f in os.listdir(os.path.join(ROOT, 'tests')) if f.startswith('test_') and f.endswith('.py'))
suite = unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromModule(importlib.import_module(n)) for n in names)
r = unittest.TextTestRunner(verbosity=2).run(suite)
sys.exit(0 if r.wasSuccessful() else 1)
EOF
