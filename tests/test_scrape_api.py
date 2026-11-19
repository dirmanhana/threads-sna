"""Tes untuk fitur pengumpulan data lewat web.

Endpoint diuji dengan scraper stub (bukan Playwright sungguhan) supaya tes
tidak mengakses Threads, tidak memakai sesi login, dan tidak menimpa data.json.
"""
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import llm_server  # noqa: E402
import scrape_threads  # noqa: E402

STUB = r'''
import argparse, json, sys, time
ap = argparse.ArgumentParser()
ap.add_argument("mode"); ap.add_argument("target", nargs="?")
ap.add_argument("--progress-file", default="")
ap.add_argument("--out", default="")
ap.add_argument("--max-posts", type=int, default=10)
ap.add_argument("--max-replies", type=int, default=400)
ap.add_argument("--replace", action="store_true")
ap.add_argument("--web", action="store_true")
ap.add_argument("--profile-dir", default="")
ap.add_argument("--login-marker", default="")
ap.add_argument("--login-timeout", type=int, default=300)
a = ap.parse_args()
def progress(phase, **kw):
    if not a.progress_file: return
    d = {"phase": phase, "done": 1, "total": 1, "message": "dari stub"}
    d.update(kw)
    with open(a.progress_file, "w", encoding="utf-8") as f: json.dump(d, f)
if a.mode == "web-login":
    progress("done", message="login stub", success=True)
    print("login stub", file=sys.stderr)
else:
    progress("scrape")
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump({"posts": [{"code": "STUB1", "author": "stub", "text": "halo"}]}, f)
    progress("done", saved=1, message="selesai stub")
    print("scrape stub", file=sys.stderr)
'''


class ValidasiTest(unittest.TestCase):
    def test_mode_dan_target(self):
        cases = [
            ({"mode": "profile", "target": "@akun_1"}, True),
            ({"mode": "keyword", "target": "pemilu 2026"}, True),
            ({"mode": "post", "target": "https://www.threads.com/@akun/post/ABC123"}, True),
            ({"mode": "post", "target": "https://contoh.com/@akun/post/ABC"}, False),
            ({"mode": "profile", "target": ""}, False),
            ({"mode": "profile", "target": "akun/bahaya"}, False),
            ({"mode": "hapus", "target": "x"}, False),
            ({"mode": "profile", "target": "x" * 400}, False),
        ]
        for body, valid in cases:
            with self.subTest(body=body):
                req, err = llm_server.validate_scrape_body(body)
                self.assertEqual(req is not None, valid, err)
                self.assertEqual(bool(err), not valid)

    def test_batas_dan_merge(self):
        req, err = llm_server.validate_scrape_body({
            "mode": "profile", "target": "akun", "maxPosts": 999,
            "maxReplies": -5, "merge": "false",
        })
        self.assertIsNone(err)
        self.assertEqual(req["maxPosts"], 100)
        self.assertEqual(req["maxReplies"], 1)
        self.assertFalse(req["merge"])
        req, _ = llm_server.validate_scrape_body({"mode": "profile", "target": "akun"})
        self.assertTrue(req["merge"])


class HelperTest(unittest.TestCase):
    def test_tulis_progres_atomik(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "progres.json"
            scrape_threads.write_progress(p, "scrape", done=2, total=5, message="jalan")
            self.assertEqual(json.loads(p.read_text())["done"], 2)
            self.assertFalse((Path(d) / "progres.json.tmp").exists())

    def test_simpan_dengan_backup(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "data.json"
            out.write_text('{"posts": []}', encoding="utf-8")
            scrape_threads.save_json(out, {"posts": [1]}, backup=True)
            self.assertEqual(json.loads(out.read_text())["posts"], [1])
            self.assertEqual(json.loads(out.with_suffix(".json.bak").read_text())["posts"], [])
            self.assertFalse(out.with_suffix(".json.tmp").exists())

    def test_sesi_tidak_aktif_tanpa_profil(self):
        with tempfile.TemporaryDirectory() as d:
            old = llm_server.PROFILE_DIR
            llm_server.PROFILE_DIR = Path(d)
            try:
                self.assertFalse(llm_server.session_active())
            finally:
                llm_server.PROFILE_DIR = old


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        d = Path(cls.tmp.name)
        cls.stub = d / "stub_scraper.py"
        cls.stub.write_text(STUB, encoding="utf-8")
        cls.data = d / "data.json"
        cls.prog = d / "scrape_progress.json"
        cls.login_prog = d / "login_progress.json"
        cls.marker = d / "login_marker"
        cls.originals = {
            "SCRAPER": llm_server.SCRAPER, "DATA": llm_server.DATA,
            "SCRAPE_PROGRESS": llm_server.SCRAPE_PROGRESS,
            "LOGIN_PROGRESS": llm_server.LOGIN_PROGRESS,
            "LOGIN_MARKER": llm_server.LOGIN_MARKER,
            "PROFILE_DIR": llm_server.PROFILE_DIR,
            "external_pid": llm_server.external_pid,
        }
        # Jangan biarkan proses scraper nyata/sisa tes lain mengganggu guard proses ganda.
        llm_server.external_pid = lambda name, own=(): None
        llm_server.SCRAPER = cls.stub
        llm_server.DATA = cls.data
        llm_server.SCRAPE_PROGRESS = cls.prog
        llm_server.LOGIN_PROGRESS = cls.login_prog
        llm_server.LOGIN_MARKER = cls.marker
        llm_server.PROFILE_DIR = d / "profil_kosong"
        handler = lambda *a, **kw: llm_server.Handler(*a, directory=str(ROOT), **kw)
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.base = "http://127.0.0.1:%d" % cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        for k, v in cls.originals.items():
            setattr(llm_server, k, v)
        cls.tmp.cleanup()

    def get(self, path):
        try:
            with urllib.request.urlopen(self.base + path, timeout=5) as r:
                return r.status, r.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            e.read()
            e.close()
            raise

    def get_json(self, path):
        _, text = self.get(path)
        return json.loads(text)

    def setUp(self):
        self.post("/api/scrape/cancel")
        self.post("/api/login/cancel")

    def wait_login_done(self, timeout=6):
        import time
        end = time.time() + timeout
        while time.time() < end:
            if not self.get_json("/api/login/status")["running"]:
                return
            time.sleep(0.1)
        self.fail("login tidak selesai dalam batas waktu")

    def post(self, path, body=None, token=True, origin=None):
        data = json.dumps(body or {}).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if token:
            if not getattr(self, "_token", None):
                self._token = self.get_json("/api/session")["token"]
            headers["X-SNA-Token"] = self._token
        if origin:
            headers["Origin"] = origin
        req = urllib.request.Request(self.base + path, data=data,
                                     headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                return r.status, json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            try:
                return e.code, json.loads(e.read().decode("utf-8"))
            finally:
                e.close()

    def wait_done(self, timeout=6):
        import time
        end = time.time() + timeout
        while time.time() < end:
            st = self.get_json("/api/scrape/status")
            if st["phase"] == "done" and not st["running"]:
                return st
            time.sleep(0.1)
        self.fail("job tidak selesai dalam batas waktu")

    def test_halaman_dan_status(self):
        code, html = self.get("/scrape.html")
        self.assertEqual(code, 200)
        self.assertIn('id="root"', html)
        code, st = self.get("/api/scrape/status")
        self.assertEqual(code, 200)
        for key in ("running", "phase", "log", "data", "login"):
            self.assertIn(key, st)
        code, login = self.get("/api/login/status")
        self.assertEqual(code, 200)
        self.assertIn("active", login)

    def test_api_wajib_token_dan_origin(self):
        code, res = self.post("/api/scrape/cancel", token=False)
        self.assertEqual(code, 401, res)
        code, res = self.post("/api/scrape/cancel", origin="http://evil.example")
        self.assertEqual(code, 403, res)
        code, res = self.post("/api/scrape/cancel", origin=self.base)
        self.assertEqual(code, 200, res)

    def test_validasi_ditolak(self):
        code, res = self.post("/api/scrape/start", {"mode": "hapus", "target": "x"})
        self.assertEqual(code, 400)
        self.assertFalse(res["started"])

    def test_scrape_stub_menulis_data(self):
        code, res = self.post("/api/scrape/start", {
            "mode": "profile", "target": "stub", "maxPosts": 1, "merge": True})
        self.assertEqual(code, 202, res)
        self.assertTrue(res["started"])
        st = self.wait_done()
        self.assertEqual(st["saved"], 1)
        self.assertEqual(st["data"]["posts"], 1)
        self.assertTrue(self.data.exists())

    def test_file_sensitif_tertutup(self):
        for path in ("/scrape_progress.json", "/login_progress.json", "/login_selesai.marker",
                     "/threads_profile/Local%20State", "/.env"):
            with self.subTest(path=path):
                with self.assertRaises(urllib.error.HTTPError) as ctx:
                    self.get(path)
                self.assertEqual(ctx.exception.code, 404)

    def test_login_stub(self):
        code, res = self.post("/api/login/start")
        self.assertEqual(code, 202, res)
        self.wait_login_done()
        self.assertFalse(self.get_json("/api/login/status")["running"])
        code, res = self.post("/api/login/confirm")
        self.assertEqual(code, 200)
        self.assertTrue(self.marker.exists())


if __name__ == "__main__":
    unittest.main()
