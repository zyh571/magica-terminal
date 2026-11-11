import importlib.machinery
import importlib.util
import os
import unittest

_path = os.path.join(os.path.dirname(__file__), "..", "magica-terminal")
_loader = importlib.machinery.SourceFileLoader("magica_terminal", _path)
mt = importlib.util.module_from_spec(importlib.util.spec_from_loader("magica_terminal", _loader))
_loader.exec_module(mt)


class AttachArgs(unittest.TestCase):
    def test_nothing_picks_by_clicking(self):
        self.assertEqual(mt.attach_args(""), (False, ""))

    def test_name(self):
        self.assertEqual(mt.attach_args("qemu"), (False, "qemu"))
        self.assertEqual(mt.attach_args("My VM"), (False, "My VM"))
        self.assertEqual(mt.attach_args("'My VM'"), (False, "My VM"))

    def test_freeze(self):
        self.assertEqual(mt.attach_args("--freeze"), (True, ""))
        self.assertEqual(mt.attach_args("-f qemu"), (True, "qemu"))
        self.assertEqual(mt.attach_args("qemu --freeze"), (True, "qemu"))

    def test_unbalanced_quote(self):
        self.assertEqual(mt.attach_args("it's"), (False, "it's"))


class HelperError(unittest.TestCase):
    def test_missing_extension(self):
        msg = mt.helper_error("GDBus.Error:org.freedesktop.DBus.Error.UnknownMethod: No such interface")
        self.assertIn("log out and back in", msg)

    def test_other(self):
        self.assertEqual(mt.helper_error("Timeout was reached"), "attach: Timeout was reached")


if __name__ == "__main__":
    unittest.main()
