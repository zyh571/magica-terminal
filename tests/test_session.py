import importlib.machinery
import importlib.util
import os
import time
import unittest

_path = os.path.join(os.path.dirname(__file__), "..", "magica-terminal")
_loader = importlib.machinery.SourceFileLoader("magica_terminal", _path)
mt = importlib.util.module_from_spec(importlib.util.spec_from_loader("magica_terminal", _loader))
_loader.exec_module(mt)
Gtk, Vte = mt.Gtk, mt.Vte


class RestoredTextTest(unittest.TestCase):
    """What a restored pane is fed before its shell starts: the saved text and a faint line under it."""

    def test_lines_and_marker(self):
        out = mt.restored_text("$ ls\na  b\n\n\n").decode()
        self.assertEqual(out, "$ ls\r\na  b\r\n\033[2m── restored ──\033[0m\r\n")

    def test_control_characters_dropped(self):   # the file could hold anything: no escape sequences get through
        out = mt.restored_text("x\033]0;magica:crush\007y\x9b2Jz\tw").decode()
        self.assertTrue(out.startswith("x]0;magica:crushy2Jz\tw\r\n"), repr(out))

    def test_empty(self):
        self.assertEqual(mt.restored_text(""), b"")
        self.assertEqual(mt.restored_text(" \n \n"), b"")

    def test_keeps_the_last_lines(self):
        out = mt.restored_text("\n".join(str(i) for i in range(mt.HISTORY_LINES + 50))).decode()
        self.assertTrue(out.startswith("50\r\n"))


@unittest.skipUnless(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"), "needs a display")
class HistoryRoundTripTest(unittest.TestCase):
    """A pane's text (scrollback too) read with Pane.history_text comes back the same in a fresh terminal."""

    def terminal(self):
        win = Gtk.Window()
        term = Vte.Terminal()
        term.set_size(30, 5)
        win.add(term)
        win.show_all()
        self.addCleanup(win.destroy)
        return term

    def settle(self):
        end = time.monotonic() + 0.5
        while time.monotonic() < end:
            Gtk.main_iteration_do(False)

    def test_round_trip(self):
        pane = type("P", (), {})()
        pane.term = self.terminal()
        for i in range(20):   # more than the 5 rows: most of it is in the scrollback
            pane.term.feed(f"line {i}\r\n".encode())
        pane.term.feed(b"\033[31mred\033[0m and a long line that wraps past thirty columns")
        self.settle()
        text = mt.Pane.history_text(pane)
        self.assertEqual(text.split("\n")[0], "line 0")
        self.assertTrue(text.endswith("red and a long line that wraps past thirty columns"), repr(text))

        again = type("P", (), {})()
        again.term = self.terminal()
        again.term.feed(mt.restored_text(text))
        self.settle()
        self.assertEqual(mt.Pane.history_text(again), text + "\n── restored ──")


if __name__ == "__main__":
    unittest.main()
