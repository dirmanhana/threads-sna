#!/usr/bin/env python3
"""Server lokal statis + API analisis LLM + API pengumpulan data Threads.

Kredensial tetap dibaca dari .env oleh llm_analyze.py di proses terpisah;
browser hanya memanggil /api/analyze dan /api/status, jadi kunci API tidak
pernah dikirim ke browser. Demikian pula sesi login Threads disimpan di
threads_profile/ dan tidak pernah dikirim ke browser.

Endpoint pengumpulan data:
    GET  /api/scrape/status   status job, progres, log, dan info data.json
    POST /api/scrape/start    {mode, target, maxPosts, maxReplies, merge}
    POST /api/scrape/cancel   hentikan job berjalan
    GET  /api/login/status    status sesi login Threads
    POST /api/login/start     buka Chromium untuk login manual
    POST /api/login/confirm   tanda "saya sudah login" (fallback deteksi cookie)
    POST /api/login/cancel    tutup browser login

Jalankan lewat: ./run.sh serve [port]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import signal
import sqlite3
import subprocess
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
PROGRESS = ROOT / "llm_progress.json"
RESULT = ROOT / "llm_analysis.json"
SCRAPER = ROOT / "scrape_threads.py"
PROFILE_DIR = ROOT / "threads_profile"
SCRAPE_PROGRESS = ROOT / "scrape_progress.json"
LOGIN_PROGRESS = ROOT / "login_progress.json"
LOGIN_MARKER = ROOT / "login_selesai.marker"
DATA = ROOT / "data.json"

_state = {"proc": None, "lock": threading.Lock(), "log": [], "error": None, "args": None}
_job = {"proc": None, "lock": threading.Lock(), "log": [], "error": None, "args": None}
_login = {"proc": None, "lock": threading.Lock(), "log": [], "error": None}
_browser_lock = threading.Lock()
SENSITIVE = (
    "/.env", "/llm_analysis.lock", "/llm_progress.json",
    "/scrape_progress.json", "/login_progress.json", "/login_selesai.marker",
    "/threads_profile", "/failed.json",
)


# ---------- utilitas proses ----------

def own_pid(state: dict) -> tuple[int, ...]:
    proc = state.get("proc")
    return (proc.pid,) if proc else ()


def is_running(state: dict) -> bool:
    proc = state.get("proc")
    return proc is not None and proc.poll() is None


def external_pid(name: str, own: tuple[int, ...] = ()) -> int | None:
    """PID proses script di luar server ini (mis. dijalankan manual lewat terminal)."""
    try:
        pattern = "[%s]%s" % (name[0], name[1:])
        out = subprocess.run(["pgrep", "-f", pattern],
                             capture_output=True, text=True, timeout=3)
        for pid in (int(x) for x in out.stdout.split() if x.isdigit()):
            if pid not in own:
                return pid
    except Exception:
        pass
    return None


def kill_proc(state: dict) -> bool:
    """Hentikan proses beserta anak-anaknya (Chromium dipijalankan di process group baru)."""
    proc = state.get("proc")
    if not proc or proc.poll() is not None:
        return False
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except Exception:
        try:
            proc.terminate()
        except Exception:
            pass
    try:
        proc.wait(timeout=5)
    except Exception:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except Exception:
            pass
    state["error"] = "Dibatalkan dari halaman web."
    return True


def start_subprocess(cmd: list[str], state: dict, tag: str,
                     progress_file: Path | None = None) -> subprocess.Popen:
    """Jalankan job background, gabungkan stdout/stderr sebagai log, dan bersihkan progres lama."""
    if progress_file:
        try:
            progress_file.unlink(missing_ok=True)
        except OSError:
            pass
    state["error"] = None
    state["log"] = []
    proc = subprocess.Popen(cmd, cwd=str(ROOT), stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True, bufsize=1,
                            start_new_session=True)
    state["proc"] = proc
    threading.Thread(target=drain_to, args=(proc, state, tag), daemon=True).start()
    return proc


# ---------- status analisis LLM (perilaku lama dipertahankan) ----------

def progress_data() -> dict:
    try:
        d = json.loads(PROGRESS.read_text(encoding="utf-8"))
        return {"done": int(d.get("done", 0)), "total": int(d.get("total", 0)),
                "labeled": int(d.get("labeled", 0))}
    except Exception:
        return {"done": 0, "total": 0, "labeled": 0}


def result_info() -> dict | None:
    if not RESULT.exists():
        return None
    try:
        d = json.loads(RESULT.read_text(encoding="utf-8-sig"))
        counts = d.get("counts") or {}
        return {"labeled": counts.get("labeled"), "topics": counts.get("topics"),
                "model": d.get("model"), "generated_at": d.get("generated_at"),
                "mtime": RESULT.stat().st_mtime}
    except Exception:
        return None


def status_payload() -> dict:
    proc = _state["proc"]
    running = proc is not None and proc.poll() is None
    ext = None if running else external_pid("llm_analyze.py", own_pid(_state))
    prog = progress_data()
    message = None
    if running:
        message = "Analisis berjalan di server ini."
    elif ext:
        message = "Analisis sudah berjalan dalam proses lain (PID %d)." % ext
    return {
        "running": running or ext is not None,
        "external": bool(ext) and not running,
        "pid": proc.pid if running else ext,
        "message": message,
        "done": prog["done"], "total": prog["total"], "labeled": prog["labeled"],
        "error": _state["error"], "result": result_info(),
    }


def drain(proc: subprocess.Popen) -> None:
    """Kuras stderr supaya pipe tidak penuh, lalu simpan error terakhir (khusus LLM)."""
    if proc.stderr:
        for line in proc.stderr:
            text = line.rstrip()
            _state["log"].append(text)
            if len(_state["log"]) > 200:
                _state["log"].pop(0)
        code = proc.wait()
        if code != 0:
            _state["error"] = " | ".join(_state["log"][-4:]) or ("keluar dengan kode %d" % code)


# ---------- status pengumpulan data & login ----------

def read_json(path: Path, fallback):
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception:
        return fallback


def session_active() -> bool:
    """Cek cookie sesi Threads pada profil Playwright (tanpa membaca nilainya)."""
    db = PROFILE_DIR / "Default" / "Cookies"
    if not db.exists():
        return False
    try:
        con = sqlite3.connect("file:%s?mode=ro" % db, uri=True, timeout=2)
        try:
            row = con.execute(
                "select 1 from cookies where host_key like '%threads.com%' "
                "and name in ('sessionid','ds_user_id') and length(encrypted_value)>0 limit 1"
            ).fetchone()
            return bool(row)
        finally:
            con.close()
    except Exception:
        return False


def data_info() -> dict:
    info = {"exists": DATA.exists(), "posts": 0, "mtime": None,
            "size": DATA.stat().st_size if DATA.exists() else 0, "backup": None}
    if info["exists"]:
        try:
            d = json.loads(DATA.read_text(encoding="utf-8-sig"))
            posts = d.get("posts") if isinstance(d, dict) else d
            info["posts"] = len(posts) if isinstance(posts, list) else 0
            info["mtime"] = DATA.stat().st_mtime
        except Exception:
            pass
    bak = Path(str(DATA) + ".bak")
    if bak.exists():
        info["backup"] = bak.stat().st_mtime
    return info


def login_status_payload() -> dict:
    running = is_running(_login)
    prog = read_json(LOGIN_PROGRESS, {})
    active = session_active()
    message = prog.get("message") or ("Sesi login aktif." if active else "Belum ada sesi login.")
    return {
        "running": running,
        "active": active,
        "phase": prog.get("phase") if running else ("done" if prog.get("success") else ""),
        "message": message,
        "error": _login["error"] or prog.get("error"),
        "log": _login["log"][-30:],
    }


def scrape_status_payload() -> dict:
    running = is_running(_job)
    logging_in = is_running(_login)
    ext = None if (running or logging_in) else external_pid(
        "scrape_threads.py", own_pid(_job) + own_pid(_login))
    prog = read_json(SCRAPE_PROGRESS, {})
    phase = prog.get("phase") or ("scrape" if running else "")
    message = prog.get("message") or ("Scraping berjalan…" if running else "Siap.")
    return {
        "running": running or ext is not None,
        "external": bool(ext) and not running,
        "pid": _job["proc"].pid if running else ext,
        "phase": phase,
        "done": int(prog.get("done") or 0),
        "total": int(prog.get("total") or 0),
        "saved": prog.get("saved"),
        "message": message,
        "error": _job["error"] or prog.get("error"),
        "log": _job["log"][-60:],
        "data": data_info(),
        "login": login_status_payload(),
    }


def drain_to(proc: subprocess.Popen, state: dict, tag: str) -> None:
    """Kuras gabungan stdout/stderr job web supaya pipe tidak penuh."""
    stream = proc.stdout or proc.stderr
    if stream:
        for line in stream:
            text = line.rstrip()
            if not text:
                continue
            state["log"].append(text)
            if len(state["log"]) > 200:
                state["log"].pop(0)
            print("[%s] %s" % (tag, text), file=sys.stderr)
    code = proc.wait()
    if code != 0 and not state.get("error"):
        state["error"] = state["log"][-1] if state["log"] else ("keluar dengan kode %d" % code)


def validate_scrape_body(body) -> tuple[dict | None, str | None]:
    """Validasi input web; kirim 400 sebelum menyentuh browser."""
    body = body if isinstance(body, dict) else {}
    mode = str(body.get("mode") or "").strip()
    target = str(body.get("target") or "").strip()
    if mode not in ("profile", "keyword", "post"):
        return None, "Mode tidak dikenali."
    if not target or len(target) > 300:
        return None, "Target kosong atau terlalu panjang (maksimal 300 karakter)."
    if mode == "profile" and not re.fullmatch(r"@?[A-Za-z0-9._]{1,60}", target):
        return None, "Nama akun tidak valid (huruf, angka, titik, garis bawah)."
    if mode == "post" and not re.fullmatch(
            r"https?://(?:www\.)?threads\.com/@[^/\s]+/post/[\w-]+.*", target):
        return None, "URL harus berupa https://www.threads.com/@akun/post/KODE"

    def clamp(value, low, high, default):
        try:
            return max(low, min(high, int(value)))
        except (TypeError, ValueError):
            return default

    raw_merge = body.get("merge", True)
    merge = str(raw_merge).lower() not in ("false", "0", "no", "")
    return {
        "mode": mode, "target": target,
        "maxPosts": clamp(body.get("maxPosts"), 1, 100, 10),
        "maxReplies": clamp(body.get("maxReplies"), 1, 1000, 400),
        "merge": merge,
    }, None


class Handler(SimpleHTTPRequestHandler):
    server_version = "ThreadsSNA/1.0"

    def translate_path(self, path):
        """Sajikan build React dari dist/; data.json tetap dari ROOT.

        /viewer.html, /sentimen.html, dan /scrape.html adalah tiga "halaman"
        SPA yang sama, dipilih oleh src/App.jsx berdasarkan pathname. Jika
        dist/ belum ada, fallback ke file HTML lama agar server tetap berguna.
        """
        clean = path.split("?", 1)[0].split("#", 1)[0]
        has_dist = (DIST / "index.html").exists()
        if clean == "/" and has_dist:
            return str(DIST / "index.html")
        if clean in ("/viewer.html", "/sentimen.html", "/scrape.html") and has_dist:
            return str(DIST / "index.html")
        if clean.startswith("/assets/") and has_dist:
            return str(DIST / clean.lstrip("/"))
        return super().translate_path(path)

    def list_directory(self, path):
        # Jangan tampilkan daftar isi (bisa memuat .env bila dibuka peramban).
        self.send_error(404, "Tidak diizinkan")
        return None

    def json_body(self) -> dict:
        try:
            size = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(size).decode("utf-8") if size else b"{}")
            return body if isinstance(body, dict) else {}
        except Exception:
            return {}

    # ---------- GET ----------

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path in ("/api/status", "/api/result"):
            data = status_payload()
            return self.reply(200, data if path == "/api/status" else data.get("result"))
        if path == "/api/scrape/status":
            return self.reply(200, scrape_status_payload())
        if path == "/api/login/status":
            return self.reply(200, login_status_payload())
        if path == "/api/data":
            return self.reply(200, data_info())
        if any(path.startswith(x) for x in SENSITIVE):
            self.send_error(404, "Tidak ditemukan")
            return
        super().do_GET()

    # ---------- POST ----------

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        routes = {
            "/api/analyze": self.post_analyze,
            "/api/scrape/start": self.post_scrape_start,
            "/api/scrape/cancel": self.post_scrape_cancel,
            "/api/login/start": self.post_login_start,
            "/api/login/confirm": self.post_login_confirm,
            "/api/login/cancel": self.post_login_cancel,
        }
        handler = routes.get(path)
        if handler is None:
            self.send_error(404, "Tidak ditemukan")
            return
        handler()

    def post_analyze(self):
        body = self.json_body()
        limit = max(0, int(body.get("limit") or 0))
        batch = max(0, int(body.get("batchSize") or 0))
        timeout = max(0, int(body.get("timeout") or 0))

        with _state["lock"]:
            proc = _state["proc"]
            if proc is not None and proc.poll() is None:
                self.reply(409, {"started": False, "message": "Analisis masih berjalan."})
                return
            ext = external_pid("llm_analyze.py", own_pid(_state))
            if ext:
                self.reply(409, {"started": False, "message":
                                 "Analisis sudah berjalan dalam proses lain (PID %d)." % ext})
                return
            cmd = [sys.executable, str(ROOT / "llm_analyze.py")]
            if limit:
                cmd += ["--limit", str(limit)]
            if batch:
                cmd += ["--batch-size", str(batch)]
            if timeout:
                cmd += ["--timeout", str(timeout)]
            cmd += ["--progress-file", str(PROGRESS)]
            _state["error"] = None
            _state["log"] = []
            _state["args"] = body
            try:
                PROGRESS.unlink(missing_ok=True)
                proc = subprocess.Popen(cmd, cwd=str(ROOT),
                                        stdout=subprocess.DEVNULL,
                                        stderr=subprocess.PIPE, text=True, bufsize=1)
            except Exception as exc:
                self.reply(500, {"started": False, "message": "Gagal memulai: %s" % exc})
                return
            _state["proc"] = proc
            threading.Thread(target=drain, args=(proc,), daemon=True).start()
        self.reply(202, {"started": True, "pid": proc.pid})

    def post_scrape_start(self):
        req, error = validate_scrape_body(self.json_body())
        if error:
            self.reply(400, {"started": False, "message": error})
            return
        with _browser_lock:
            if is_running(_login):
                self.reply(409, {"started": False, "message": "Proses login masih berjalan."})
                return
            if is_running(_job):
                self.reply(409, {"started": False, "message": "Scraping masih berjalan."})
                return
            ext = external_pid("scrape_threads.py", own_pid(_job) + own_pid(_login))
            if ext:
                self.reply(409, {"started": False, "message":
                                 "Scraper sudah berjalan dalam proses lain (PID %d)." % ext})
                return
            cmd = [sys.executable, str(SCRAPER), req["mode"], req["target"],
                   "--max-posts", str(req["maxPosts"]),
                   "--max-replies", str(req["maxReplies"]),
                   "--out", str(DATA), "--profile-dir", str(PROFILE_DIR),
                   "--web", "--progress-file", str(SCRAPE_PROGRESS)]
            if not req["merge"]:
                cmd.append("--replace")
            try:
                proc = start_subprocess(cmd, _job, "scrape", SCRAPE_PROGRESS)
            except Exception as exc:
                self.reply(500, {"started": False, "message": "Gagal memulai: %s" % exc})
                return
            _job["args"] = req
        self.reply(202, {"started": True, "pid": proc.pid})

    def post_scrape_cancel(self):
        self.reply(200, {"stopped": kill_proc(_job)})

    def post_login_start(self):
        with _browser_lock:
            if is_running(_login):
                self.reply(409, {"started": False, "message": "Browser login sudah terbuka."})
                return
            if is_running(_job):
                self.reply(409, {"started": False, "message": "Selesaikan scraping dulu sebelum login."})
                return
            ext = external_pid("scrape_threads.py", own_pid(_job) + own_pid(_login))
            if ext:
                self.reply(409, {"started": False, "message":
                                 "Scraper/login sudah berjalan dalam proses lain (PID %d)." % ext})
                return
            cmd = [sys.executable, str(SCRAPER), "web-login", "--web",
                   "--profile-dir", str(PROFILE_DIR),
                   "--progress-file", str(LOGIN_PROGRESS),
                   "--login-marker", str(LOGIN_MARKER),
                   "--login-timeout", "300"]
            try:
                proc = start_subprocess(cmd, _login, "login", LOGIN_PROGRESS)
            except Exception as exc:
                self.reply(500, {"started": False, "message": "Gagal membuka browser: %s" % exc})
                return
        self.reply(202, {"started": True, "pid": proc.pid})

    def post_login_confirm(self):
        try:
            LOGIN_MARKER.write_text("ok", encoding="utf-8")
            ok = True
        except OSError:
            ok = False
        self.reply(200, {"ok": ok})

    def post_login_cancel(self):
        self.reply(200, {"stopped": kill_proc(_login)})

    def reply(self, code: int, data) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args), file=sys.stderr)


def main() -> int:
    ap = argparse.ArgumentParser(description="Server lokal Threads SNA + analisis LLM + scraping web")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="127.0.0.1")
    a = ap.parse_args()
    handler = lambda *args, **kw: Handler(*args, directory=str(ROOT), **kw)
    server = ThreadingHTTPServer((a.host, a.port), handler)
    mode = "build React (dist/)" if (DIST / "index.html").exists() else "HTML lama (jalankan npm run build)"
    print("Mode tampilan: %s" % mode, file=sys.stderr)
    print("Viewer:   http://%s:%d/viewer.html" % (a.host, a.port), file=sys.stderr)
    print("Sentimen: http://%s:%d/sentimen.html" % (a.host, a.port), file=sys.stderr)
    print("Data:     http://%s:%d/scrape.html" % (a.host, a.port), file=sys.stderr)
    print("API lokal: /api/analyze, /api/status, /api/scrape/*, /api/login/* "
          "(kunci & sesi tetap lokal)", file=sys.stderr)
    print("Server lokal aktif. Tekan Ctrl+C untuk berhenti.", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
