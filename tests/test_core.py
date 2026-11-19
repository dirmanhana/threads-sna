import unittest
from types import SimpleNamespace

from scrape_threads import clean, normalize_post, parse_item, parse_num, scroll_collect, to_iso


class TestHelpers(unittest.TestCase):
    def test_parse_num(self):
        self.assertEqual(parse_num("12"), 12)
        self.assertEqual(parse_num("99,3", "rb"), 99300)
        self.assertEqual(parse_num("1.234"), 1234)
        self.assertEqual(parse_num("2", "jt"), 2000000)
        self.assertIsNone(parse_num("abc"))

    def test_to_iso(self):
        self.assertEqual(to_iso("7", "10", "2026"), "2026-10-07")
        self.assertIsNone(to_iso("31", "2", "2026"))


class TestParseItem(unittest.TestCase):
    def test_metadata_dibersihkan(self):
        lines = ["sari_toko", "07/10/2026", "288 rb tayangan", "Halo @dirman",
                 "12 suka", "Like", "3", "99,3 rb tayangan"]
        text, ts, likes = parse_item(lines, "sari_toko")
        self.assertEqual(text, "Halo @dirman")
        self.assertEqual(ts, "2026-10-07")
        self.assertEqual(likes, 12)

    def test_tanggal_inline_dibuang(self):
        text, ts, _ = parse_item(["07/10/2026 Ucapan ulang tahun"], "author")
        self.assertEqual(text, "Ucapan ulang tahun")
        self.assertIsNone(ts)

    def test_thread_dan_komentar_terpisah(self):
        post = {"code": "A", "author": "dirman", "lines": ["dirman", "10 rb tayangan", "Isi thread"]}
        reply = {"code": "B", "author": "sari", "lines": ["08/10/2026", "Isi komentar"]}
        pt, pts, _ = parse_item(post["lines"], post["author"])
        rt, rts, _ = parse_item(reply["lines"], reply["author"])
        self.assertEqual(pt, "Isi thread")
        self.assertIsNone(pts)
        self.assertEqual(rt, "Isi komentar")
        self.assertEqual(rts, "2026-10-08")
        self.assertEqual(clean(reply["lines"], "sari"), "Isi komentar")

    def test_normalize_post_backward_compatible(self):
        p = normalize_post({"code": "A", "author": "dirman", "text": "x",
                            "replies": [{"code": "B", "author": "sari", "text": "y"}]})
        for key in ("thread", "timestamp", "likes", "scraped_at"):
            self.assertIn(key, p)
        for key in ("timestamp", "likes", "parent_code"):
            self.assertIn(key, p["replies"][0])


class TestScrollCollect(unittest.TestCase):
    def test_berhenti_saat_stall(self):
        item = {"code": "A", "author": "sari", "lines": ["halo"]}
        batches = [[item], [item], [item], [item]]

        class Page:
            def __init__(self):
                self.i = 0
                self.wheels = 0
                self.mouse = SimpleNamespace(wheel=lambda x, y: setattr(self, "wheels", self.wheels + 1))

            def evaluate(self, _):
                b = batches[min(self.i, len(batches) - 1)]
                self.i += 1
                return b

            def wait_for_timeout(self, _):
                pass

        page = Page()
        store = scroll_collect(page, 10, store={}, stall=2)
        self.assertEqual(len(store), 1)
        self.assertEqual(page.wheels, 2)

    def test_cap(self):
        item = {"code": "A", "author": "sari", "lines": ["halo"]}
        batches = [[item], [item]]

        class Page:
            def __init__(self):
                self.i = 0
                self.wheels = 0
                self.mouse = SimpleNamespace(wheel=lambda x, y: setattr(self, "wheels", self.wheels + 1))

            def evaluate(self, _):
                b = batches[min(self.i, len(batches) - 1)]
                self.i += 1
                return b

            def wait_for_timeout(self, _):
                pass

        page = Page()
        store = scroll_collect(page, 10, store={}, cap=1)
        self.assertEqual(len(store), 1)
        self.assertEqual(page.wheels, 0)


if __name__ == "__main__":
    unittest.main()
