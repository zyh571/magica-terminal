import importlib.machinery
import importlib.util
import os
import unittest

_path = os.path.join(os.path.dirname(__file__), "..", "magica-terminal")
_loader = importlib.machinery.SourceFileLoader("magica_terminal", _path)
mt = importlib.util.module_from_spec(importlib.util.spec_from_loader("magica_terminal", _loader))
_loader.exec_module(mt)


class WebAddress(unittest.TestCase):
    def test_empty_is_home(self):
        self.assertEqual(mt.web_address("  "), mt.BROWSER_HOME)

    def test_full_urls_kept(self):
        self.assertEqual(mt.web_address("https://example.com/a?b=1"), "https://example.com/a?b=1")
        self.assertEqual(mt.web_address("about:blank"), "about:blank")

    def test_host_names(self):
        self.assertEqual(mt.web_address("example.com"), "https://example.com")
        self.assertEqual(mt.web_address("en.wikipedia.org/wiki/Madoka"), "https://en.wikipedia.org/wiki/Madoka")
        self.assertEqual(mt.web_address("localhost:8000"), "http://localhost:8000")
        self.assertEqual(mt.web_address("127.0.0.1:5173/x"), "http://127.0.0.1:5173/x")

    def test_files(self):
        here = os.path.dirname(os.path.abspath(__file__))
        self.assertEqual(mt.web_address("test_browser.py", here), "file://" + os.path.join(here, "test_browser.py"))

    def test_search(self):
        self.assertEqual(mt.web_address("madoka magica"), mt.BROWSER_SEARCH.format("madoka+magica"))
        self.assertEqual(mt.web_address("soul gem"), mt.BROWSER_SEARCH.format("soul+gem"))


if __name__ == "__main__":
    unittest.main()
