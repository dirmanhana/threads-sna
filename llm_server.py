#!/usr/bin/env python3
"""Server lokal statis + endpoint analisis LLM untuk halaman sentimen.

Kredensial tetap dibaca dari .env oleh llm_analyze.py di proses terpisah;
browser hanya memanggil /api/analyze dan /api/status, jadi kunci API tidak
pernah dikirim ke browser. viewer.html tetap bisa dibuka lewat server statis
biasa — endpoint ini hanya dipakai sentimen.html.

Jalankan lewat: ./run.sh serve [port]
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROGRESS = ROOT / "llm_progress.json"
RESULT = ROOT / "llm_analysis.json"

_state = {"proc": None, "lock": threading.Lock(), "log": [], "error": None, "args": None}
SENSITIVE = ("/.env", "/llm_analysis.lock", "/llm_progress.json")


def external_pid() -> int | None:
    """PID proses llm_analyze.py di luar server ini (mis. dijalankan manual)."""
    try:
        out = subprocess.run(["pgrep", "-f", "[l]lm_analyze.py"],
                             capture_output=True, text=True, timeout=3)
        pids = [int(x) for x in out.stdout.split() if x.isdigit()]
        own = _state["proc"].pid if _state["proc"] else None
        for pid in pids:
            if pid != own:
                return pid
    except Exception:
        pass
    return None


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
    ext = None if running else external_pid()
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
    """Kuras stderr supaya pipe tidak penuh, lalu simpan error terakhir."""
    if proc.stderr:
        for line in proc.stderr:
            text = line.rstrip()
            _state["log"].append(text)
            if len(_state["log"]) > 200:
                _state["log"].pop(0)
    code = proc.wait()
    if code != 0:
        _state["error"] = " | ".join(_state["log"][-4:]) or ("keluar dengan kode %d" % code)


class Handler(SimpleHTTPRequestHandler):
    server_version = "ThreadsSNA/1.0"

    def list_directory(self, path):
        # Jangan tampilkan daftar isi (bisa memuat .env bila dibuka peramban).
        self.send_error(404, "Tidak diizinkan")
        return None

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path in ("/api/status", "/api/result"):
            data = status_payload()
            if path == "/api/result":
                data = data.get("result")
            body = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if any(path.startswith(x) for x in SENSITIVE):
            self.send_error(404, "Tidak ditemukan")
            return
        super().do_GET()

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path != "/api/analyze":
            self.send_error(404, "Tidak ditemukan")
            return
        try:
            size = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(size).decode("utf-8") if size else b"{}")
        except Exception:
            body = {}
        limit = max(0, int(body.get("limit") or 0))
        batch = max(0, int(body.get("batchSize") or 0))
        timeout = max(0, int(body.get("timeout") or 0))

        with _state["lock"]:
            proc = _state["proc"]
            if proc is not None and proc.poll() is None:
                self.reply(409, {"started": False, "message": "Analisis masih berjalan."})
                return
            ext = external_pid()
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
            try:
                PROGRESS.unlink(missing_ok=True)
            except OSError:
                pass
            _state["error"] = None
            _state["log"] = []
            _state["args"] = body
            try:
                proc = subprocess.Popen(cmd, cwd=str(ROOT),
                                        stdout=subprocess.DEVNULL,
                                        stderr=subprocess.PIPE, text=True, bufsize=1)
            except Exception as exc:
                self.reply(500, {"started": False, "message": "Gagal memulai: %s" % exc})
                return
            _state["proc"] = proc
            threading.Thread(target=drain, args=(proc,), daemon=True).start()
        self.reply(202, {"started": True, "pid": proc.pid})

    def reply(self, code: int, data: dict) -> None:
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
    ap = argparse.ArgumentParser(description="Server lokal Threads SNA + analisis LLM")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="127.0.0.1")
    a = ap.parse_args()
    handler = lambda *args, **kw: Handler(*args, directory=str(ROOT), **kw)
    server = ThreadingHTTPServer((a.host, a.port), handler)
    print("Viewer:   http://%s:%d/viewer.html" % (a.host, a.port), file=sys.stderr)
    print("Sentimen: http://%s:%d/sentimen.html" % (a.host, a.port), file=sys.stderr)
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
