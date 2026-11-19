import unittest
from datetime import datetime, timezone
from types import SimpleNamespace

from scrape_threads import (build_reply_tree, clean, merge_post, normalize_post,
                            parse_item, parse_item_full, parse_num, scroll_collect,
                            to_iso)


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
        for key in ("thread", "timestamp", "timestamp_source", "likes", "scraped_at",
                    "first_scraped_at", "last_scraped_at", "expected_replies",
                    "truncated", "stop_reason"):
            self.assertIn(key, p)
        for key in ("timestamp", "timestamp_source", "likes", "parent_code",
                    "root_code", "depth", "reply_to_author", "first_seen_at",
                    "last_seen_at", "still_present"):
            self.assertIn(key, p["replies"][0])


class TestTimestamp(unittest.TestCase):
    def test_waktu_relatif_jadi_estimasi(self):
        now = datetime(2026, 10, 10, 12, 0, tzinfo=timezone.utc)
        text, ts, _, source = parse_item_full(["2 j", "Halo"], "sari", now=now)
        self.assertEqual(text, "Halo")
        self.assertEqual(ts, "2026-10-10T10:00:00+00:00")
        self.assertEqual(source, "estimated")

    def test_network_mengalahkan_tanggal_dom(self):
        _, ts, _, source = parse_item_full(
            ["07/10/2026", "Halo"], "sari",
            network_ts="2026-10-07T12:34:56+00:00")
        self.assertEqual(ts, "2026-10-07T12:34:56+00:00")
        self.assertEqual(source, "network")

    def test_tanggal_jam_dom(self):
        _, ts, _, source = parse_item_full(["07/10/2026 14:30", "Halo"], "sari")
        self.assertTrue(ts.startswith("2026-10-07T"))
        self.assertEqual(source, "dom")

    def test_hint_balasan_tidak_masuk_teks(self):
        meta = {}
        text, _, _, _ = parse_item_full(["Lihat 12 balasan", "Halo"], "sari", meta=meta)
        self.assertEqual(text, "Halo")
        self.assertEqual(meta["expected_replies"], 12)


class TestMerge(unittest.TestCase):
    def test_merge_tidak_membuang_komentar_lama(self):
        old = {"code": "P", "author": "a", "text": "x",
               "scraped_at": "2026-10-01T00:00:00+00:00",
               "replies": [
                   {"code": "R1", "author": "b", "text": "lama"},
                   {"code": "R2", "author": "c", "text": "tetap ada"},
               ]}
        new = {"code": "P", "author": "a", "text": "x",
               "scraped_at": "2026-10-02T00:00:00+00:00",
               "complete": False, "truncated": True,
               "replies": [
                   {"code": "R1", "author": "b", "text": "baru"},
                   {"code": "R3", "author": "d", "text": "tambahan"},
               ]}
        p = merge_post(old, new, new["scraped_at"])
        by = {r["code"]: r for r in p["replies"]}
        self.assertEqual(set(by), {"R1", "R2", "R3"})
        self.assertEqual(by["R1"]["text"], "baru")
        self.assertEqual(by["R1"]["first_seen_at"], "2026-10-01T00:00:00+00:00")
        self.assertTrue(by["R2"]["still_present"])
        # Data lama sudah pernah di-scrape (punya scraped_at) -> hitungan menjadi 2.
        self.assertEqual(p["scrape_count"], 2)

    def test_scrape_lengkap_menandai_yang_hilang(self):
        old = {"code": "P", "author": "a", "text": "x",
               "scraped_at": "2026-10-01T00:00:00+00:00",
               "replies": [{"code": "R1", "author": "b", "text": "lama"}]}
        new = {"code": "P", "author": "a", "text": "x",
               "scraped_at": "2026-10-02T00:00:00+00:00",
               "complete": True, "truncated": False, "replies": []}
        p = merge_post(old, new, new["scraped_at"])
        self.assertFalse(p["replies"][0]["still_present"])


class TestReplyTree(unittest.TestCase):
    def test_depth_dan_parent_author(self):
        replies = [
            {"code": "R1", "author": "b", "parent_code": "P"},
            {"code": "R2", "author": "c", "parent_code": "R1"},
            {"code": "R3", "author": "d", "parent_code": None},
        ]
        build_reply_tree("P", "a", replies)
        by = {r["code"]: r for r in replies}
        self.assertEqual(by["R1"]["depth"], 1)
        self.assertEqual(by["R1"]["reply_to_author"], "a")
        self.assertEqual(by["R2"]["depth"], 2)
        self.assertEqual(by["R2"]["reply_to_author"], "b")
        self.assertEqual(by["R3"]["depth"], 1)
        self.assertEqual(by["R3"]["root_code"], "P")


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
