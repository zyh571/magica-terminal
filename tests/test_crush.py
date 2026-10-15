"""Rules of the `crush` game (CrushBoard in ../magica-terminal). Run: python3 -m unittest discover tests"""
import importlib.machinery
import importlib.util
import os
import random
import unittest

_path = os.path.join(os.path.dirname(__file__), "..", "magica-terminal")
_loader = importlib.machinery.SourceFileLoader("magica_terminal", _path)
mt = importlib.util.module_from_spec(importlib.util.spec_from_loader("magica_terminal", _loader))
_loader.exec_module(mt)


X = 5   # a character the base pattern never uses, so test pieces only match each other


def board(edits=(), seed=1, check=True):
    """An 8x8 board with no matches ((2r + c) mod 5), then `edits`: {(r, c): kind or (kind, special)}."""
    b = mt.CrushBoard(kinds=6, rng=random.Random(seed))
    b.grid = [[mt.Tile((2 * r + c) % 5) for c in range(8)] for r in range(8)]
    for (r, c), v in dict(edits).items():
        b.grid[r][c] = mt.Tile(*v) if isinstance(v, tuple) else mt.Tile(v)
    assert not check or not b.runs(), "test board already has a match"
    return b


def cleared(step):
    return {(r, c) for _, r, c in step.clears}


class Matching(unittest.TestCase):
    def test_fresh_boards_have_no_matches_and_a_move(self):
        for seed in range(50):
            b = mt.CrushBoard(rng=random.Random(seed))
            self.assertEqual(b.runs(), [])
            self.assertIsNotNone(b.hint())

    def test_swap_without_a_match_is_undone(self):
        b = board()
        before = [[t.id for t in row] for row in b.grid]
        self.assertIsNone(b.swap((0, 0), (0, 1)))
        self.assertEqual([[t.id for t in row] for row in b.grid], before)

    def test_not_neighbours(self):
        self.assertIsNone(board().swap((0, 0), (0, 2)))

    def test_three_in_a_row(self):
        b = board({(0, 0): X, (0, 1): X, (1, 2): X})
        steps = b.swap((1, 2), (0, 2))
        self.assertTrue(steps)
        self.assertEqual(cleared(steps[0]), {(0, 0), (0, 1), (0, 2)})
        self.assertEqual(steps[0].score, 60)
        self.assertEqual(steps[0].created, [])

    def test_board_is_full_after_a_turn(self):
        b = board({(0, 0): X, (0, 1): X, (1, 2): X})
        b.swap((1, 2), (0, 2))
        self.assertTrue(all(t is not None for row in b.grid for t in row))
        self.assertEqual(b.runs(), [])   # cascades ran until nothing matched


    def test_hint_is_a_move(self):
        b = board({(0, 0): X, (0, 1): X, (1, 2): X})
        self.assertIn(b.hint(), [(p, q) for p, q, _ in b.moves()])

    def test_autoplay_picks_the_bigger_match(self):
        b = board({(0, 0): X, (0, 1): X, (1, 2): X,                  # (1, 2) up: 3 in a row
                   (5, 0): X, (5, 1): X, (5, 3): X, (6, 2): X})       # (6, 2) up: 4 in a row
        self.assertEqual(b.best_move(), ((5, 2), (6, 2)))

    def test_autoplay_sets_off_a_bomb_first(self):
        b = board({(5, 0): X, (5, 1): X, (5, 3): X, (6, 2): X, (2, 3): (0, "bomb")})
        self.assertIn((2, 3), b.best_move())

    def test_autoplay_has_no_move_on_a_stuck_board(self):
        b = board()
        b.grid = [[mt.Tile((r + c) % 2 * 5 + (r + c) % 3) for c in range(8)] for r in range(8)]
        self.assertEqual(list(b.moves()), [])
        self.assertIsNone(b.best_move())

class Specials(unittest.TestCase):
    def test_four_makes_a_striped_head_where_you_moved(self):
        b = board({(3, 0): X, (3, 1): X, (3, 3): X, (4, 2): X})
        steps = b.swap((4, 2), (3, 2))
        t, r, c = steps[0].created[0]
        self.assertEqual((t.special, t.kind, r, c), ("v", X, 3, 2))   # a horizontal 4 → clears a column
        self.assertEqual(cleared(steps[0]), {(3, 0), (3, 1), (3, 3)})
        self.assertEqual(steps[0].score, 120)

    def test_five_makes_a_bomb(self):
        b = board({(5, 0): X, (5, 1): X, (5, 3): X, (5, 4): X, (6, 2): X})
        steps = b.swap((6, 2), (5, 2))
        t, r, c = steps[0].created[0]
        self.assertEqual((t.special, t.kind, r, c), ("bomb", None, 5, 2))
        self.assertEqual(cleared(steps[0]), {(5, 0), (5, 1), (5, 3), (5, 4)})
        self.assertEqual(steps[0].score, 200)

    def test_long_runs_clear_whole_and_score_more(self):
        # a swap fills one gap, so runs longer than 5 come from cascades: resolve one directly
        b = board({(5, c): X for c in range(7)}, check=False)
        steps = b.resolve()
        self.assertEqual(steps[0].score, 7 * 6 * 10)   # 3 → 60, 4 → 120, 5 → 200, 6 → 300, 7 → 420
        self.assertEqual(steps[0].created[0][0].special, "bomb")
        self.assertEqual(len(cleared(steps[0])), 6)   # the 7th became the bomb

    def test_l_shape_makes_a_wrapped_head(self):
        b = board({(2, 0): X, (2, 1): X, (0, 2): X, (1, 2): X, (3, 2): X})
        steps = b.swap((3, 2), (2, 2))
        t, r, c = steps[0].created[0]
        self.assertEqual((t.special, r, c), ("wrapped", 2, 2))

    def test_striped_clears_its_row_and_sets_off_another(self):
        # a striped "h" head in a 3-match on row 4 clears row 4, which hits a striped "v" head at (4, 7) → column 7
        b = board({(4, 0): (X, "h"), (4, 1): X, (5, 2): X, (4, 7): (0, "v")})
        steps = b.swap((5, 2), (4, 2))
        hit = cleared(steps[0])
        self.assertTrue({(4, c) for c in range(8)} <= hit)
        self.assertTrue({(r, 7) for r in range(8)} <= hit)
        self.assertEqual([f[0] for f in steps[0].fires], ["h", "v"])

    def test_wrapped_goes_off_twice(self):
        b = board({(4, 3): (X, "wrapped"), (4, 4): X, (5, 5): X})
        steps = b.swap((5, 5), (4, 5))
        first = cleared(steps[0])
        self.assertNotIn((4, 3), first)   # still there, armed
        self.assertTrue({(3, 2), (5, 4), (5, 2)} <= first)
        armed = [s for s in steps[1:] if any(f[0] == "armed" for f in s.fires)]
        self.assertTrue(armed, "the armed head went off again after the fall")
        self.assertFalse(any(t.special == "armed" for row in b.grid for t in row))

    def test_bomb_with_a_head_clears_that_character(self):
        b = board({(0, 0): (None, "bomb")})
        kind = b.at((0, 1)).kind
        targets = {p for p in b.cells() if b.at(p).kind == kind}
        steps = b.swap((0, 0), (0, 1))
        self.assertTrue(targets <= cleared(steps[0]))
        self.assertEqual(steps[0].fires[0][0], "bomb")

    def test_bomb_with_striped_turns_them_all_striped(self):
        b = board({(0, 0): (None, "bomb"), (0, 1): (1, "h")})
        steps = b.swap((0, 0), (0, 1))
        self.assertTrue(steps[0].transforms)
        self.assertTrue(all(t.special in ("h", "v") for t, _, _ in steps[0].transforms))

    def test_two_bombs_clear_the_board(self):
        b = board({(0, 0): (None, "bomb"), (0, 1): (None, "bomb")})
        steps = b.swap((0, 0), (0, 1))
        self.assertEqual(len(cleared(steps[0])), 64)

    def test_two_striped_clear_a_row_and_a_column(self):
        b = board({(3, 3): (0, "h"), (3, 4): (1, "h")})
        steps = b.swap((3, 3), (3, 4))
        hit = cleared(steps[0])
        self.assertTrue({(3, c) for c in range(8)} <= hit)
        self.assertTrue(any(all((r, c) in hit for r in range(8)) for c in (3, 4)))

    def test_wrapped_and_wrapped_is_a_5x5_blast(self):
        b = board({(3, 3): (0, "wrapped"), (3, 4): (1, "wrapped")})
        steps = b.swap((3, 3), (3, 4))
        self.assertTrue({(r, c) for r in range(1, 6) for c in range(2, 7)} <= cleared(steps[0]))


class Turns(unittest.TestCase):
    def test_falls_move_heads_down_and_drop_new_ones(self):
        b = board({(0, 0): X, (0, 1): X, (1, 2): X})
        above = b.at((1, 0))   # row 0 is the top: nothing falls, new heads drop into row 0
        steps = b.swap((1, 2), (0, 2))
        falls = steps[0].falls
        self.assertEqual(sorted((c, fr, to) for _, c, fr, to in falls if fr < 0), [(0, -1, 0), (1, -1, 0), (2, -1, 0)])
        self.assertIs(b.at((1, 0)), above)

    def test_cascades_multiply(self):
        for seed in range(200):   # find a refill that cascades
            b = board({(0, 0): X, (0, 1): X, (1, 2): X}, seed=seed)
            steps = b.swap((1, 2), (0, 2))
            if len(steps) > 1:
                self.assertEqual([s.combo for s in steps], list(range(1, len(steps) + 1)))
                self.assertEqual(steps[1].score % 2, 0)
                return
        self.fail("no cascade in 200 seeds")

    def test_chain_luck_makes_longer_chains_that_still_end(self):
        def chains(luck, stripes):
            lens = []
            for seed in range(20):
                b = mt.CrushBoard(rng=random.Random(seed), luck=luck, stripes=stripes, fade=0.72)
                for _ in range(30):
                    move = b.hint()
                    if move is None:
                        b.shuffle()
                        continue
                    lens.append(len(b.swap(*move)))
            return sum(lens) / len(lens), max(lens)
        plain, lucky = chains(0, 0), chains(0.4, 0.05)
        self.assertGreater(lucky[0], plain[0] * 1.3)
        self.assertLess(lucky[1], 30)

    def test_no_luck_outside_a_chain(self):
        b = board()
        for r, c in b.cells():
            b.grid[r][c] = None if r == 0 else b.grid[r][c]
        b.luck, b.stripes = 1, 1
        b.gravity()   # combo 0: an ordinary refill
        self.assertFalse(any(b.at((0, c)).special for c in range(8)))

    def test_shuffle_leaves_a_move_and_no_matches(self):
        b = board()
        ids = sorted(t.id for row in b.grid for t in row)
        b.shuffle()
        self.assertEqual(sorted(t.id for row in b.grid for t in row), ids)
        self.assertEqual(b.runs(), [])
        self.assertIsNotNone(b.hint())

    def test_random_games_stay_consistent(self):
        """Lots of random moves (specials included): the board always ends full, settled and with no armed heads."""
        for seed in range(30):
            rng = random.Random(seed)
            b = mt.CrushBoard(rng=random.Random(seed))
            for _ in range(60):
                for p in rng.sample(b.cells(), 3):   # sprinkle specials so their combos get played too
                    b.at(p).special = rng.choice(["h", "v", "wrapped", None, None])
                if b.runs():
                    b.resolve()
                move = b.hint()
                if move is None:
                    b.shuffle()
                    continue
                steps = b.swap(*move)
                self.assertTrue(steps)
                self.assertTrue(all(t is not None for row in b.grid for t in row))
                self.assertEqual(b.runs(), [])
                self.assertFalse(any(t.special == "armed" for row in b.grid for t in row))
                for step in steps:
                    self.assertTrue(step.clears or step.created)


if __name__ == "__main__":
    unittest.main()
