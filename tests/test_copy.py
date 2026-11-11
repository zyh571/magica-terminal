import fcntl
import importlib.machinery
import importlib.util
import os
import subprocess
import tempfile
import termios
import unittest

_root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
_shim_dir = os.path.join(_root, "shell", "bin")


class WlCopyShimTest(unittest.TestCase):
    """shell/bin/wl-copy: in a pane it hands the text to the terminal through the title instead of running the real
    wl-copy (which makes GNOME pop up a notification); anything else goes to the real one (a fake here)."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.fake = os.path.join(self.tmp.name, "fake")
        os.makedirs(self.fake)
        with open(os.path.join(self.fake, "wl-copy"), "w") as f:
            f.write('#!/bin/sh\necho "real: $*"\n')
        os.chmod(os.path.join(self.fake, "wl-copy"), 0o755)

    def tearDown(self):
        self.tmp.cleanup()

    def run_shim(self, args, stdin="", **extra):
        """Run the shim with a pty as its terminal; returns (what it wrote to the terminal, its stdout)."""
        master, slave = os.openpty()

        def own_tty():
            os.setsid()
            fcntl.ioctl(slave, termios.TIOCSCTTY, 0)

        env = {"PATH": f"{_shim_dir}:{self.fake}:/usr/bin:/bin", "MAGICA_CHAR": "madoka",
               "XDG_RUNTIME_DIR": self.tmp.name, **extra}
        r = subprocess.run(["wl-copy", *args], input=stdin, capture_output=True, text=True, env=env,
                           preexec_fn=own_tty, pass_fds=(slave,), timeout=10)
        os.close(slave)
        os.set_blocking(master, False)
        try:
            tty = os.read(master, 65536).decode()
        except (BlockingIOError, OSError):
            tty = ""
        os.close(master)
        return tty, r.stdout

    def copied(self, tty):
        self.assertTrue(tty.startswith("\033]0;magica:copy:") and tty.endswith("\007"), repr(tty))
        which, _, path = tty[len("\033]0;magica:copy:"):-1].partition(":")
        self.assertEqual(os.path.dirname(path), os.path.join(self.tmp.name, "magica-terminal-copy"))
        with open(path) as f:
            return which, f.read()

    def test_stdin(self):
        tty, out = self.run_shim([], "héllo\nworld\n")
        self.assertEqual(out, "")
        self.assertEqual(self.copied(tty), ("clipboard", "héllo\nworld\n"))

    def test_words_primary_and_trim(self):
        self.assertEqual(self.copied(self.run_shim(["-p", "a", "b"])[0]), ("primary", "a b"))
        self.assertEqual(self.copied(self.run_shim(["-n"], "x\n")[0]), ("clipboard", "x"))
        self.assertEqual(self.copied(self.run_shim(["--type", "text/plain"], "t")[0]), ("clipboard", "t"))

    def test_clear(self):
        self.assertEqual(self.run_shim(["--clear"])[0], "\033]0;magica:copy:clear:clipboard\007")

    def test_passes_through(self):
        for args, extra in ((["--type", "image/png"], {}), ([], {"TMUX": "x"}), ([], {"MAGICA_CHAR": ""}),
                            (["--weird"], {})):
            tty, out = self.run_shim(args, **extra)
            self.assertEqual((tty, out.strip()), ("", f"real: {' '.join(args)}".strip()), (args, extra))


_path = os.path.join(_root, "magica-terminal")
_loader = importlib.machinery.SourceFileLoader("magica_terminal", _path)
mt = importlib.util.module_from_spec(importlib.util.spec_from_loader("magica_terminal", _loader))
_loader.exec_module(mt)


class CopyFromPaneTest(unittest.TestCase):
    """The terminal's side: only its own files are read (anything in a pane can set the title), then deleted."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = os.path.join(self.tmp.name, "magica-terminal-copy")
        os.makedirs(self.dir)
        self.old, mt.COPY_DIR = mt.COPY_DIR, self.dir
        self.got = []
        self.old_get = mt.Gtk.Clipboard.get
        got = self.got

        class Clip:
            def __init__(self, which):
                self.which = which

            def set_text(self, text, n):
                got.append((self.which, text))

        mt.Gtk.Clipboard.get = staticmethod(lambda which: Clip(which))

    def tearDown(self):
        mt.COPY_DIR = self.old
        mt.Gtk.Clipboard.get = self.old_get
        self.tmp.cleanup()

    def test_reads_and_deletes(self):
        path = os.path.join(self.dir, "abc")
        with open(path, "w") as f:
            f.write("hi")
        mt.copy_from_pane(f"clipboard:{path}")
        self.assertEqual(self.got, [(mt.Gdk.SELECTION_CLIPBOARD, "hi")])
        self.assertFalse(os.path.exists(path))

    def test_only_its_own_folder(self):
        path = os.path.join(self.tmp.name, "secret")
        with open(path, "w") as f:
            f.write("no")
        mt.copy_from_pane(f"clipboard:{path}")
        mt.copy_from_pane(f"clipboard:{self.dir}/../secret")
        mt.copy_from_pane("elsewhere:x")
        self.assertEqual(self.got, [])
        self.assertTrue(os.path.exists(path))

    def test_clear(self):
        mt.copy_from_pane("clear:primary")
        self.assertEqual(self.got, [(mt.Gdk.SELECTION_PRIMARY, "")])


if __name__ == "__main__":
    unittest.main()
