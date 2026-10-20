import importlib.machinery
import importlib.util
import os
import tempfile
import time
import unittest

_path = os.path.join(os.path.dirname(__file__), "..", "magica-terminal")
_loader = importlib.machinery.SourceFileLoader("magica_terminal", _path)
mt = importlib.util.module_from_spec(importlib.util.spec_from_loader("magica_terminal", _loader))
_loader.exec_module(mt)


def du(path):
    """Disk usage the slow, obvious way (no hard-link dedup needed in these trees unless noted)."""
    total = os.lstat(path).st_blocks * 512
    if os.path.isdir(path) and not os.path.islink(path):
        for name in os.listdir(path):
            total += du(os.path.join(path, name))
    return total


def wait(scan):
    deadline = time.monotonic() + 10
    while scan.running and time.monotonic() < deadline:
        time.sleep(0.01)
    assert not scan.running


def write(path, n):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(os.urandom(n))


class DiskScanTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.top = os.path.join(self.tmp.name, "top")
        write(os.path.join(self.top, "big.bin"), 300_000)
        write(os.path.join(self.top, "a", "one.bin"), 50_000)
        write(os.path.join(self.top, "a", "deep", "two.bin"), 120_000)
        write(os.path.join(self.top, "b", "small.txt"), 10)
        os.symlink("/usr", os.path.join(self.top, "link"))   # not followed

    def tearDown(self):
        self.tmp.cleanup()

    def test_sizes_match_du(self):
        scan = mt.DiskScan(self.top)
        wait(scan)
        root = scan.root
        self.assertEqual(root.size, du(self.top))
        self.assertEqual(root.children["a"].size, du(os.path.join(self.top, "a")))
        self.assertEqual(root.children["a"].children["deep"].size, du(os.path.join(self.top, "a", "deep")))
        self.assertIsNone(root.children["link"].children)   # a symlink is an item, not a folder
        self.assertTrue(all(c.listed for c in root.children.values()))
        self.assertEqual(root.children["a"].children["deep"].path, os.path.join(self.top, "a", "deep"))

    def test_hard_links_counted_once(self):
        os.link(os.path.join(self.top, "big.bin"), os.path.join(self.top, "b", "same.bin"))
        scan = mt.DiskScan(self.top)
        wait(scan)
        self.assertEqual(scan.root.size, du(self.top) - os.lstat(os.path.join(self.top, "big.bin")).st_blocks * 512)

    def test_going_up_keeps_the_scanned_folder(self):
        write(os.path.join(self.tmp.name, "sibling.bin"), 70_000)
        scan = mt.DiskScan(self.top)
        wait(scan)
        old = scan.root
        parent = scan.start(self.tmp.name, inside=old)
        wait(scan)
        self.assertIs(parent.children["top"], old)
        self.assertEqual(old.path, self.top)
        self.assertEqual(parent.size, du(self.tmp.name))

    def test_unreadable_folder(self):
        locked = os.path.join(self.top, "locked")
        os.mkdir(locked)
        os.chmod(locked, 0)
        try:
            scan = mt.DiskScan(self.top)
            wait(scan)
            if os.geteuid() != 0:
                self.assertTrue(scan.root.children["locked"].error)
        finally:
            os.chmod(locked, 0o755)


class HumanSize(unittest.TestCase):
    def test_units(self):
        self.assertEqual(mt.human_size(0), "0 B")
        self.assertEqual(mt.human_size(1023), "1023 B")
        self.assertEqual(mt.human_size(1536), "1.5 KB")
        self.assertEqual(mt.human_size(5 * 1024 ** 3), "5.0 GB")


if __name__ == "__main__":
    unittest.main()
