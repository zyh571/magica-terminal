import os
import subprocess
import tempfile
import unittest

_bash = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "shell", "magica.bash")


class EnvTest(unittest.TestCase):
    """The shell integration's .env loading: drives _magica_env (what runs before every prompt) in a plain bash."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = os.path.join(self.tmp.name, "home")
        self.proj = os.path.join(self.tmp.name, "proj")
        os.makedirs(os.path.join(self.proj, "sub"))
        os.makedirs(self.home)

    def tearDown(self):
        self.tmp.cleanup()

    def env(self, text, where=None):
        with open(os.path.join(where or self.proj, ".env"), "w") as f:
            f.write(text)

    def run_bash(self, script, answers=""):
        r = subprocess.run(
            ["bash", "--norc", "--noprofile", "-c", f'. "{_bash}"\n{script}'],
            input=answers, capture_output=True, text=True, cwd=self.tmp.name,
            env={"HOME": self.home, "PATH": os.environ["PATH"], "MAGICA_CHAR": "madoka", "KEEP": "outer"},
        )
        self.assertEqual(r.stderr, "")
        return r.stdout

    def test_asks_loads_and_unloads(self):
        self.env("# keys\nexport API_KEY=abc123\nDB_URL = 'postgres://x#y'\nQ=\"a \\\"b\\\"\\nc\"  # note\nPLAIN=v # c\nbad line\nKEEP=inner\n")
        out = self.run_bash(
            f'cd "{self.proj}"; _magica_env\n'
            'printf "[%s|%s|%s|%s|%s]\\n" "$API_KEY" "$DB_URL" "$Q" "$PLAIN" "$KEEP"\n'
            'bash -c \'echo "child=$API_KEY"\'\n'
            'cd sub; _magica_env\n'
            'printf "[%s|%s|%s]\\n" "${API_KEY-unset}" "${DB_URL-unset}" "$KEEP"\n',
            answers="y\n",
        )
        self.assertIn("load .env here? (API_KEY, DB_URL, Q, PLAIN, KEEP) [y/n]", out)
        self.assertIn("loaded .env: API_KEY, DB_URL, Q, PLAIN, KEEP", out)
        self.assertIn('[abc123|postgres://x#y|a "b"\nc|v|inner]', out)
        self.assertIn("child=abc123", out)
        self.assertIn("unloaded .env", out)
        self.assertIn("[unset|unset|outer]", out)
        self.assertNotIn("abc123\x1b", out)  # values are never in her messages
        with open(os.path.join(self.home, ".config/magica-terminal/env-trust")) as f:
            self.assertEqual(f.read(), f"y\t{self.proj}\n")

    def test_remembers_answers(self):
        self.env("A=1\n")
        out = self.run_bash(f'cd "{self.proj}"; _magica_env; cd ..; _magica_env; cd "{self.proj}"; _magica_env; echo "A=${{A-unset}}"', "y\n")
        self.assertEqual(out.count("load .env here?"), 1)
        self.assertIn("A=1", out)
        other = os.path.join(self.tmp.name, "other")
        os.makedirs(other)
        self.env("B=2\n", other)
        out = self.run_bash(f'cd "{other}"; _magica_env; cd ..; _magica_env; cd "{other}"; _magica_env; echo "B=${{B-unset}}"', "n\n")
        self.assertEqual(out.count("load .env here?"), 1)
        self.assertIn("B=unset", out)

    def test_no_answer_asks_again_only_after_coming_back(self):
        self.env("A=1\n")
        out = self.run_bash(f'cd "{self.proj}"; _magica_env; _magica_env; cd ..; _magica_env; cd "{self.proj}"; _magica_env; echo "A=${{A-unset}}"', "\n")
        self.assertEqual(out.count("load .env here?"), 2)
        self.assertIn("A=unset", out)

    def test_reloads_after_edit_and_restores_shell_variable(self):
        self.env("A=1\nLOCAL=from-env\n")
        out = self.run_bash(
            f'LOCAL=mine; cd "{self.proj}"; _magica_env; echo "A=$A"\n'
            f'sleep 1.1; printf "A=2\\n" > .env; _magica_env; echo "A=$A LOCAL=${{LOCAL-unset}}"\n'
            'cd /; _magica_env; echo "A=${A-unset} LOCAL=$LOCAL"; bash -c \'echo "child=${LOCAL-unset}"\'\n',
            "y\n",
        )
        self.assertIn("A=1", out)
        self.assertIn("reloaded .env: A", out)
        self.assertIn("A=2 LOCAL=mine", out)
        self.assertIn("A=unset LOCAL=mine", out)
        self.assertIn("child=unset", out)  # LOCAL was never exported, and isn't after unloading either

    def test_keeps_exit_status(self):
        self.env("A=1\n")
        out = self.run_bash(f'cd "{self.proj}"; false; _magica_env; echo "s=$?"', "y\n")
        self.assertIn("s=1", out)


if __name__ == "__main__":
    unittest.main()
