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
    return "".join("x" if on else "." for on in mt.cell_inks(snippet, FG, BG))


class CellInks(unittest.TestCase):
    def test_blank(self):
        self.assertEqual(ink("<pre></pre>"), "")
        self.assertEqual(ink("<pre>      </pre>"), "......")

    def test_plain_text(self):
        self.assertEqual(ink("<pre>  ls -la</pre>"), "..xx.xxx")

    def test_coloured_cell_without_text(self):
        self.assertEqual(ink('<pre><span style="background-color:#C00000">   </span></pre>'), "xxx")

    def test_cell_the_colour_of_the_background(self):
        self.assertEqual(ink('<pre><span style="background-color:#1E1E1D">   </span></pre>'), "...")

    def test_text_the_colour_of_its_cell(self):
        self.assertEqual(ink('<pre><font color="#1F1F1E">hidden</font></pre>'), "......")
        self.assertEqual(ink('<pre><font color="#878700">slot</font></pre>'), "xxxx")

    def test_nesting(self):
        self.assertEqual(ink('<pre><span style="background-color:#D4D2CC"><font color="#000000">R</font> </span>a</pre>'), "xxx")
        self.assertEqual(ink('<pre><font color="#1D1D1C">x</font> y</pre>'), "..x")

    def test_entities_newlines_and_wide_characters(self):
        self.assertEqual(ink("<pre>&lt; a\n</pre>"), "x.x")
        self.assertEqual(ink("<pre>魔法 x</pre>"), "xxxx.x")


if __name__ == "__main__":
    unittest.main()
