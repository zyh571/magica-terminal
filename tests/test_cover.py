import importlib.machinery
import importlib.util
import os
import unittest

_path = os.path.join(os.path.dirname(__file__), "..", "magica-terminal")
_loader = importlib.machinery.SourceFileLoader("magica_terminal", _path)
mt = importlib.util.module_from_spec(importlib.util.spec_from_loader("magica_terminal", _loader))
_loader.exec_module(mt)

FG, BG = "#d4d2cc", "#1d1d1c"


def ink(snippet):
    return mt.shows_ink(snippet, FG, BG)


class ShowsInk(unittest.TestCase):
    def test_blank(self):
        self.assertFalse(ink("<pre></pre>"))
        self.assertFalse(ink("<pre>      </pre>"))

    def test_plain_text(self):
        self.assertTrue(ink("<pre>  ls -la</pre>"))

    def test_coloured_cell_without_text(self):
        self.assertTrue(ink('<pre><span style="background-color:#C00000">   </span></pre>'))

    def test_cell_the_colour_of_the_background(self):
        self.assertFalse(ink('<pre><span style="background-color:#1E1E1D">   </span></pre>'))

    def test_text_the_colour_of_its_cell(self):
        self.assertFalse(ink('<pre><font color="#1F1F1E">hidden</font></pre>'))
        self.assertTrue(ink('<pre><font color="#878700">slot</font></pre>'))

    def test_nesting(self):
        self.assertTrue(ink('<pre><span style="background-color:#D4D2CC"><font color="#000000">R</font></span></pre>'))
        self.assertFalse(ink('<pre><font color="#1D1D1C">x</font> </pre>'))

    def test_entities(self):
        self.assertTrue(ink("<pre>&lt;</pre>"))


if __name__ == "__main__":
    unittest.main()
