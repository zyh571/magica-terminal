import importlib.machinery
import importlib.util
import os
import tempfile
import unittest

_path = os.path.join(os.path.dirname(__file__), "..", "magica-terminal")
_loader = importlib.machinery.SourceFileLoader("magica_terminal", _path)
mt = importlib.util.module_from_spec(importlib.util.spec_from_loader("magica_terminal", _loader))
_loader.exec_module(mt)


class NoteMarksTest(unittest.TestCase):
    """The notepad's markup: <head>Title<head> headers and *bold* words, as (start, end, inner start, inner end)."""

    def test_headers(self):
        text = "<head>Shopping<head>\nmilk\n<head> Work </head>\n<head>no end\n<head><head>"
        heads, _ = mt.note_marks(text)
        self.assertEqual([text[i:j] for _, _, i, j in heads], ["Shopping", " Work "])
        s, e, _, _ = heads[0]
        self.assertEqual(text[s:e], "<head>Shopping<head>")

    def test_header_stays_on_one_line(self):
        heads, _ = mt.note_marks("<head>a\nb<head>")
        self.assertEqual(heads, [])

    def test_bold(self):
        text = "buy *milk* and *two eggs* * not * a*b*c **"
        _, bolds = mt.note_marks(text)
        self.assertEqual([text[i:j] for _, _, i, j in bolds], ["milk", "two eggs"])   # (not a*b*c: 2*3*4 stays maths)

    def test_bullets_are_not_bold(self):
        _, bolds = mt.note_marks("* one\n* two\n")
        self.assertEqual(bolds, [])


@unittest.skipUnless(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"), "needs a display")
class NotesMouseTest(unittest.TestCase):
    """GTK 3 aborts the whole program ("Byte index .. is off the end of the line") when it maps the mouse onto a line
    with invisible text, so the hidden tags mustn't be that: point at every spot of a note full of them."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()   # (the note autosaves while these wait on GTK: never the real one)
        self.addCleanup(tmp.cleanup)
        mt.NOTE_FILE = os.path.join(tmp.name, "note.txt")

    def test_pointing_while_editing(self):
        # (seeded edits and cursor moves, pointing between each: the invisible-text version aborted in both seeds)
        import random
        import types
        Gtk = mt.Gtk
        pane = types.SimpleNamespace(theme=mt.THEMES["light"], colour="#d9566c", win=types.SimpleNamespace(font_scale=1.0))

        def pump():
            while Gtk.events_pending():
                Gtk.main_iteration()

        for seed in (1, 2):
            rnd = random.Random(seed)
            notes = mt.Notes(pane)
            win = Gtk.Window()
            win.resize(700, 500)
            win.add(notes)
            win.show_all()
            b = notes.buffer
            b.set_text("")
            pump()
            for _ in range(250):
                r = rnd.random()
                if r < 0.3 and notes.heads:
                    s, e, i, j = rnd.choice(notes.heads + notes.heads)
                    b.place_cursor(b.get_iter_at_offset(rnd.choice([s, e, i, j, e + 1, max(s - 1, 0)])))
                elif r < 0.5:
                    b.place_cursor(b.get_iter_at_offset(rnd.randrange(len(notes.text()) + 1)))
                elif r < 0.85:
                    b.insert_at_cursor(rnd.choice(["a", " ", "*", "x", "\n", "<head>"]))
                else:
                    it = b.get_iter_at_mark(b.get_insert())
                    back = it.copy()
                    back.backward_char()
                    b.delete(back, it)
                for _ in range(2):
                    for _ in range(4):
                        notes.view.get_iter_at_location(rnd.randrange(0, 700), rnd.randrange(0, 3000))
                    pump()
            notes.dirty = False
            win.destroy()

    def test_jump_puts_the_header_at_the_top(self):
        import time
        import types
        Gtk = mt.Gtk
        pane = types.SimpleNamespace(theme=mt.THEMES["light"], colour="#d9566c", win=types.SimpleNamespace(font_scale=1.0))

        def pump(t=0.5):
            end = time.monotonic() + t
            while time.monotonic() < end:
                Gtk.main_iteration_do(False)
                time.sleep(0.002)

        notes = mt.Notes(pane)
        win = Gtk.Window()
        win.resize(600, 400)
        win.add(notes)
        win.show_all()
        long = "a long line that wraps over and over again in a narrow window " * 6 + "\n"   # (guessed heights)
        notes.buffer.set_text("".join(f"<head>Section {k}<head>\n" + long * 8 for k in range(10)))
        notes.buffer.place_cursor(notes.buffer.get_start_iter())
        pump()
        for k in (6, 2, 8):
            notes.jump(k)
            pump()
            y, _ = notes.view.get_line_yrange(notes.buffer.get_iter_at_offset(notes.heads[k][0]))
            self.assertEqual(y - notes.view.get_visible_rect().y, notes.view.get_top_margin(), k)   # where line 1 sits
        notes.dirty = False
        win.destroy()


if __name__ == "__main__":
    unittest.main()
