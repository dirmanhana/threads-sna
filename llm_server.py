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
import secrets
import signal
import sqlite3
import subprocess
import sys
import threading
import posixpath
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

import projects as project_store

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
SCRAPER = ROOT / "scrape_threads.py"
PROFILE_DIR = ROOT / "threads_profile"
LOGIN_PROGRESS = ROOT / "login_progress.json"
LOGIN_MARKER = ROOT / "login_selesai.marker"

_state = {"proc": None, "lock": threading.Lock(), "log": [], "error": None, "args": None}
_job = {"proc": None, "lock": threading.Lock(), "log": [], "error": None, "args": None}
_login = {"proc": None, "lock": threading.Lock(), "log": [], "error": None}
_browser_lock = threading.Lock()
API_TOKEN = secrets.token_urlsafe(32)
SENSITIVE = (
    "/.env", "/llm_analysis.lock", "/llm_progress.json",
    "/scrape_progress.json", "/login_progress.json", "/login_selesai.marker",
    "/threads_profile", "/failed.json", "/index.json",
    "/data.json", "/llm_analysis.json", "/data.json.bak",
)
# File proyek yang boleh dibaca peramban (sisanya dianggap sensitif).
PROJECT_PUBLIC = {"data.json", "llm_analysis.json"}


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

def progress_data(path: Path) -> dict:
    try:
        d = json.loads(path.read_text(encoding="utf-8"))
        return {"done": int(d.get("done", 0)), "total": int(d.get("total", 0)),
                "labeled": int(d.get("labeled", 0))}
    except Exception:
        return {"done": 0, "total": 0, "labeled": 0}


def result_info(slug: str) -> dict | None:
    try:
        p = project_store.paths(slug)
    except ValueError:
        return None
    result = p["analysis"]
    if not result.exists():
        return None
    try:
        d = json.loads(result.read_text(encoding="utf-8-sig"))
        counts = d.get("counts") or {}
        return {"labeled": counts.get("labeled"), "topics": counts.get("topics"),
                "model": d.get("model"), "generated_at": d.get("generated_at"),
                "mtime": result.stat().st_mtime}
    except Exception:
        return None


def status_payload(slug: str = "default") -> dict:
    try:
        p = project_store.paths(slug)
    except ValueError:
        return {"running": False, "project": slug, "done": 0, "total": 0,
                "labeled": 0, "result": None, "error": "Slug proyek tidak valid."}
    proc = _state["proc"]
    running = proc is not None and proc.poll() is None
    ext = None if running else external_pid("llm_analyze.py", own_pid(_state))
    prog = progress_data(p["llm_progress"])
    job_project = (_state.get("args") or {}).get("project") or "default"
    message = None
    if running:
        message = ("Analisis proyek %s berjalan di server ini." % job_project
                   if job_project == slug else
                   "Analisis proyek %s sedang berjalan." % job_project)
    elif ext:
        message = "Analisis sudah berjalan dalam proses lain (PID %d)." % ext
    return {
        "running": running or ext is not None,
        "external": bool(ext) and not running,
        "pid": proc.pid if running else ext,
        "project": slug,
        "jobProject": job_project if running else None,
        "message": message,
        "done": prog["done"], "total": prog["total"], "labeled": prog["labeled"],
        "error": _state["error"], "result": result_info(slug),
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


def data_info(slug: str = "default") -> dict:
    try:
        data = project_store.paths(slug)["data"]
    except ValueError:
        return {"exists": False, "posts": 0, "mtime": None, "size": 0, "backup": None}
    info = {"exists": data.exists(), "posts": 0, "mtime": None,
            "size": data.stat().st_size if data.exists() else 0, "backup": None,
            "project": slug}
    if info["exists"]:
        try:
            d = json.loads(data.read_text(encoding="utf-8-sig"))
            posts = d.get("posts") if isinstance(d, dict) else d
            info["posts"] = len(posts) if isinstance(posts, list) else 0
            info["mtime"] = data.stat().st_mtime
        except Exception:
            pass
    bak = Path(str(data) + ".bak")
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


def scrape_status_payload(slug: str = "default") -> dict:
    running = is_running(_job)
    logging_in = is_running(_login)
    ext = None if (running or logging_in) else external_pid(
        "scrape_threads.py", own_pid(_job) + own_pid(_login))
    try:
        progress = project_store.paths(slug)["progress"]
    except ValueError:
        progress = Path("/nonexistent")
    prog = read_json(progress, {})
    phase = prog.get("phase") or ("scrape" if running else "")
    job_project = (_job.get("args") or {}).get("project") or "default"
    message = prog.get("message") or ("Scraping berjalan…" if running else "Siap.")
    if running and job_project != slug:
        message = "Scraping proyek %s sedang berjalan." % job_project
    return {
        "running": running or ext is not None,
        "external": bool(ext) and not running,
        "pid": _job["proc"].pid if running else ext,
        "project": slug,
        "jobProject": job_project if running else None,
        "phase": phase,
        "done": int(prog.get("done") or 0),
        "total": int(prog.get("total") or 0),
        "saved": prog.get("saved"),
        "message": message,
        "error": _job["error"] or prog.get("error"),
        "log": _job["log"][-60:],
        "data": data_info(slug),
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
    project = str(body.get("project") or "default").strip()
    if not project_store.valid_slug(project):
        return None, "Slug proyek tidak valid."
    return {
        "mode": mode, "target": target, "project": project,
        "maxPosts": clamp(body.get("maxPosts"), 1, 100, 10),
        "maxReplies": clamp(body.get("maxReplies"), 1, 1000, 400),
        "merge": merge,
    }, None


class Handler(SimpleHTTPRequestHandler):
    server_version = "ThreadsSNA/1.0"

    def translate_path(self, path):
        """Sajikan build React dari dist/; data.json tetap dari ROOT.

        /viewer.html, /sentimen.html, /scrape.html, dan /ringkasan.html adalah
        halaman SPA yang sama, dipilih oleh src/App.jsx berdasarkan pathname.
        Jika dist/ belum ada, fallback ke file HTML lama agar server tetap berguna.
        """
        clean = path.split("?", 1)[0].split("#", 1)[0]
        has_dist = (DIST / "index.html").exists()
        if clean == "/" and has_dist:
            return str(DIST / "index.html")
        if clean in ("/viewer.html", "/sentimen.html", "/scrape.html",
                     "/ringkasan.html", "/summary.html", "/index.html") and has_dist:
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

    # ---------- pengamanan API lokal ----------

    def _loopback_names(self):
        port = self.server.server_address[1]
        names = {"127.0.0.1", "localhost", "[::1]"}
        return names | {f"{name}:{port}" for name in names}

    def host_allowed(self) -> bool:
        """Tolak DNS rebinding: hanya Host loopback yang sah."""
        host = (self.headers.get("Host") or "").strip().lower()
        return bool(host) and host in {x.lower() for x in self._loopback_names()}

    def origin_allowed(self) -> bool:
        """Tolak CSRF lintas-origin; request tanpa Origin (CLI/tes) tetap boleh."""
        origin = (self.headers.get("Origin") or "").strip().lower()
        if not origin:
            return True
        return origin in {f"http://{x}".lower() for x in self._loopback_names()}

    def token_allowed(self) -> bool:
        got = self.headers.get("X-SNA-Token") or ""
        return bool(got) and secrets.compare_digest(got, API_TOKEN)

    # ---------- GET ----------

    def query_project(self) -> str:
        query = parse_qs(urlsplit(self.path).query)
        return str((query.get("project") or ["default"])[0] or "default")

    def project_or_error(self, slug: str):
        if not project_store.valid_slug(slug):
            self.reply(400, {"error": "Slug proyek tidak valid.",
                             "message": "Slug proyek tidak valid.", "started": False})
            return None
        meta = project_store.get_project(slug)
        if not meta:
            self.reply(404, {"error": "Proyek tidak ditemukan.",
                             "message": "Proyek tidak ditemukan.", "started": False})
            return None
        return meta

    def do_GET(self):
        parts = urlsplit(self.path)
        path = parts.path
        if not self.host_allowed():
            return self.reply(403, {"error": "Host tidak diizinkan."})
        if path == "/api/session":
            if not self.origin_allowed():
                return self.reply(403, {"error": "Origin tidak diizinkan."})
            return self.reply(200, {"token": API_TOKEN})
        if path == "/api/projects":
            return self.reply(200, {"projects": project_store.list_projects(),
                                    "default": "default"})
        slug = self.query_project()
        if path in ("/api/status", "/api/result", "/api/scrape/status", "/api/data"):
            meta = self.project_or_error(slug)
            if not meta:
                return
        if path in ("/api/status", "/api/result"):
            data = status_payload(slug)
            return self.reply(200, data if path == "/api/status" else data.get("result"))
        if path == "/api/scrape/status":
            return self.reply(200, scrape_status_payload(slug))
        if path == "/api/login/status":
            return self.reply(200, login_status_payload())
        if path == "/api/data":
            return self.reply(200, data_info(slug))
        if path.startswith("/projects/"):
            if not self.serve_project_file(path):
                return
        if any(path.startswith(x) for x in SENSITIVE):
            self.send_error(404, "Tidak ditemukan")
            return
        super().do_GET()

    def serve_project_file(self, path: str) -> bool:
        """Sajikan hanya projects/<slug>/<data.json|llm_analysis.json>; tolak sisanya."""
        segments = [s for s in path.split("/") if s not in ("", ".")]
        ok = (len(segments) == 3 and segments[0] == "projects"
              and project_store.valid_slug(segments[1])
              and segments[2] in PROJECT_PUBLIC)
        if not ok:
            self.send_error(404, "Tidak ditemukan")
            return False
        try:
            target = (project_store.project_dir(segments[1]) / segments[2]).resolve()
        except ValueError:
            self.send_error(404, "Tidak ditemukan")
            return False
        if not target.is_file():
            self.send_error(404, "Tidak ditemukan")
            return False
        body = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)
        return True

    # ---------- POST ----------

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if not self.host_allowed():
            return self.reply(403, {"started": False, "message": "Host tidak diizinkan."})
        if not self.origin_allowed():
            return self.reply(403, {"started": False, "message": "Origin tidak diizinkan."})
        if not self.token_allowed():
            return self.reply(401, {"started": False, "message":
                                    "Token API tidak valid. Muat ulang halaman."})
        routes = {
            "/api/analyze": self.post_analyze,
            "/api/projects": self.post_project_create,
            "/api/projects/rename": self.post_project_rename,
            "/api/projects/delete": self.post_project_delete,
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

    def post_project_create(self):
        body = self.json_body()
        try:
            project = project_store.create_project(body.get("name"), body.get("slug"))
        except ValueError as exc:
            self.reply(400, {"created": False, "message": str(exc)})
            return
        self.reply(201, {"created": True, "project": project})

    def post_project_rename(self):
        body = self.json_body()
        slug = str(body.get("slug") or "").strip()
        try:
            project = project_store.rename_project(slug, body.get("name"))
        except FileNotFoundError:
            self.reply(404, {"renamed": False, "message": "Proyek tidak ditemukan."})
            return
        except ValueError as exc:
            self.reply(400, {"renamed": False, "message": str(exc)})
            return
        self.reply(200, {"renamed": True, "project": project})

    def post_project_delete(self):
        body = self.json_body()
        slug = str(body.get("slug") or "").strip()
        try:
            info = project_store.delete_project(slug)
        except FileNotFoundError:
            self.reply(404, {"deleted": False, "message": "Proyek tidak ditemukan."})
            return
        except ValueError as exc:
            self.reply(400, {"deleted": False, "message": str(exc)})
            return
        self.reply(200, {"deleted": True, **info})

    def post_analyze(self):
        body = self.json_body()
        slug = str(body.get("project") or "default").strip()
        if not self.project_or_error(slug):
            return
        limit = max(0, int(body.get("limit") or 0))
        batch = max(0, int(body.get("batchSize") or 0))
        timeout = max(0, int(body.get("timeout") or 0))
        paths = project_store.paths(slug)

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
            cmd = [sys.executable, str(ROOT / "llm_analyze.py"),
                   "--in", str(paths["data"]), "--out", str(paths["analysis"]),
                   "--progress-file", str(paths["llm_progress"])]
            if limit:
                cmd += ["--limit", str(limit)]
            if batch:
                cmd += ["--batch-size", str(batch)]
            if timeout:
                cmd += ["--timeout", str(timeout)]
            _state["error"] = None
            _state["log"] = []
            _state["args"] = {**body, "project": slug}
            try:
                paths["llm_progress"].unlink(missing_ok=True)
                proc = subprocess.Popen(cmd, cwd=str(ROOT),
                                        stdout=subprocess.DEVNULL,
                                        stderr=subprocess.PIPE, text=True, bufsize=1)
            except Exception as exc:
                self.reply(500, {"started": False, "message": "Gagal memulai: %s" % exc})
                return
            _state["proc"] = proc
            threading.Thread(target=drain, args=(proc,), daemon=True).start()
        self.reply(202, {"started": True, "pid": proc.pid, "project": slug})

    def post_scrape_start(self):
        req, error = validate_scrape_body(self.json_body())
        if error:
            self.reply(400, {"started": False, "message": error})
            return
        slug = req["project"]
        if not self.project_or_error(slug):
            return
        paths = project_store.paths(slug)
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
                   "--out", str(paths["data"]), "--failed", str(paths["failed"]),
                   "--profile-dir", str(PROFILE_DIR),
                   "--web", "--progress-file", str(paths["progress"])]
            if not req["merge"]:
                cmd.append("--replace")
            try:
                proc = start_subprocess(cmd, _job, "scrape", paths["progress"])
            except Exception as exc:
                self.reply(500, {"started": False, "message": "Gagal memulai: %s" % exc})
                return
            _job["args"] = req
        self.reply(202, {"started": True, "pid": proc.pid, "project": slug})

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
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
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
    migrated = project_store.ensure_default_project()
    if migrated:
        print("Proyek default dibuat dari data lama: %s" % migrated["slug"], file=sys.stderr)
    handler = lambda *args, **kw: Handler(*args, directory=str(ROOT), **kw)
    server = ThreadingHTTPServer((a.host, a.port), handler)
    mode = "build React (dist/)" if (DIST / "index.html").exists() else "HTML lama (jalankan npm run build)"
    print("Mode tampilan: %s" % mode, file=sys.stderr)
    print("Ringkasan: http://%s:%d/" % (a.host, a.port), file=sys.stderr)
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
