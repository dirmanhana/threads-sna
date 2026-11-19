import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import llm_analyze as la


class TestEnv(unittest.TestCase):
    def test_load_env(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / ".env"
            p.write_text(
                "# komentar\nLLM_MODEL=cmd\nLLM_API_KEY=' sk-rahasia '\n\nBROKEN\n",
                encoding="utf-8",
            )
            env = la.load_env(p)
            self.assertEqual(env["LLM_MODEL"], "cmd")
            self.assertEqual(env["LLM_API_KEY"], "sk-rahasia")
            self.assertNotIn("BROKEN", env)

    def test_load_env_missing(self):
        self.assertEqual(la.load_env(Path("/tidak/ada/.env")), {})


class TestKeys(unittest.TestCase):
    def test_norm(self):
        self.assertEqual(la.norm("Mantap @budiman!!! https://x.co/a 🔥"), "mantap")
        self.assertEqual(la.norm("Setuju kak, harga nya mahal"), "setuju kak harga nya mahal")

    def test_content_key_matches_browser(self):
        # Nilai ini juga dipakai test Node (tests/test_viewer.mjs).
        self.assertEqual(la.content_key("budi", "A1", "Mantap @host!!!"), "f1ad6100b000eebc")
        self.assertEqual(la.content_key("sari", "X9", "Halo dunia"), "ae5207c62875cdf2")
        self.assertEqual(la.content_key("", "", "teks"), "68bdfa3821b7f5fc")

    def test_collect_unique_replies_only(self):
        posts = [{
            "code": "A1", "author": "host",
            "thread": [{"author": "host", "text": "lanjutan"}],
            "replies": [
                {"author": "budi", "text": "halo @host"},
                {"author": "budi", "text": "halo @host"},
                {"author": "", "text": ""},
                {"author": "sari", "text": "setuju"},
            ],
        }]
        items = la.collect(posts)
        self.assertEqual(len(items), 2)
        self.assertEqual([x["author"] for x in items], ["budi", "sari"])
        self.assertEqual(items[0]["post"], "A1")
        self.assertEqual(la.collect(None), [])


class TestParse(unittest.TestCase):
    def test_parse_json_variants(self):
        self.assertEqual(la.parse_json('[{"i":1}]'), [{"i": 1}])
        self.assertEqual(la.parse_json('```json\n[{"i":2}]\n```'), [{"i": 2}])
        self.assertEqual(la.parse_json('hasil: {"a":1}'), {"a": 1})
        with self.assertRaises(Exception):
            la.parse_json("bukan json")

    def test_normalize_topics_and_labels(self):
        topics = la.normalize_topics([
            {"id": 0, "label": "Kepolisian", "keywords": "polisi, kapolda"},
            {"id": 1, "label": "Gibran", "keywords": ["wapres", "gibran"]},
            "sampah",
        ])
        self.assertEqual(len(topics), 2)
        self.assertEqual(topics[0]["keywords"], ["polisi", "kapolda"])
        labels = la.normalize_labels([
            {"i": 1, "sentiment": "NEGATIF", "emotion": "marah", "toxicity": 2,
             "spam": True, "topic": 99, "alasan": "x" * 200},
            {"i": 2, "sentiment": "aneh", "emotion": "?", "toxicity": "x", "topic": 1, "i": 2},
            {"i": 99, "sentiment": "positif"},
        ], 2, {0, 1})
        self.assertEqual(labels[1]["sentiment"], "negatif")
        self.assertEqual(labels[1]["toxicity"], 1.0)
        self.assertTrue(labels[1]["spam"])
        self.assertEqual(labels[1]["topic"], 0, "topic di luar daftar jatuh ke id pertama")
        self.assertEqual(len(labels[1]["alasan"]), 120)
        self.assertEqual(labels[2]["sentiment"], "netral")
        self.assertNotIn(99, labels)

    def test_call_llm_uses_env(self):
        cfg = {"LLM_BASE_URL": "https://contoh.test/v1/", "LLM_API_KEY": "sk-x", "LLM_MODEL": "cmd"}
        captured = {}

        class Resp:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                return b'{"choices":[{"message":{"content":"{\\"ok\\":true}"}}]}'

        def fake_urlopen(req, timeout):
            captured["url"] = req.full_url
            captured["auth"] = req.headers["Authorization"]
            captured["ua"] = req.headers["User-agent"]
            captured["model"] = json.loads(req.data)["model"]
            captured["max_tokens"] = json.loads(req.data)["max_tokens"]
            return Resp()

        with patch.object(la.urllib.request, "urlopen", fake_urlopen):
            out = la.call_llm(cfg, [{"role": "user", "content": "hai"}], 30)
        self.assertEqual(json.loads(out), {"ok": True})
        self.assertEqual(captured["url"], "https://contoh.test/v1/chat/completions")
        self.assertEqual(captured["auth"], "Bearer sk-x")
        self.assertTrue(captured["ua"].startswith("Mozilla/5.0"))
        self.assertEqual(captured["model"], "cmd")
        self.assertTrue(captured["max_tokens"] > 0)


if __name__ == "__main__":
    unittest.main()
