"""Manajemen profil Threads (sesi Playwright) untuk scraping.

Setiap profil punya folder user-data-dir sendiri:
    threads_profiles/
      index.json        {version, active, profiles:[{id,name,created_at,updated_at}]}
      <id>/profile/     Playwright persistent context (cookies/sesi) - sensitif

Folder ini sensitif: jangan diekspos via HTTP/static dan jangan di-commit.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STORE = ROOT / "threads_profiles"
LEGACY = ROOT / "threads_profile"
INDEX = STORE / "index.json"
ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,40}$")
SESSION_COOKIES = ("sessionid", "ds_user_id")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _read_index() -> dict:
    try:
        data = json.loads(INDEX.read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("profiles"), list):
            data.setdefault("version", 1)
            data.setdefault("active", "")
            return data
    except Exception:
        pass
    return {"version": 1, "active": "", "profiles": []}


def _write_index(data: dict) -> None:
    STORE.mkdir(parents=True, exist_ok=True)
    data["updated_at"] = now_iso()
    tmp = INDEX.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(INDEX)


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", str(name or "").strip().lower()).strip("-")
    slug = re.sub(r"-{2,}", "-", slug)[:32].strip("-")
    return slug or "profil"


def _unique_id(base: str, existing: set[str]) -> str:
    cand = base
    n = 2
    while cand in existing or (STORE / cand).exists():
        suffix = f"-{n}"
        cand = (base[: max(1, 32 - len(suffix))].rstrip("-") + suffix) or f"profil-{n}"
        n += 1
    return cand


def ensure_store() -> dict:
    STORE.mkdir(parents=True, exist_ok=True)
    data = _read_index()
    changed = False
    # Normalisasi entri
    clean = []
    seen = set()
    for p in data.get("profiles", []):
        if not isinstance(p, dict):
            continue
        pid = str(p.get("id") or "").strip()
        name = str(p.get("name") or "").strip()
        if not ID_RE.fullmatch(pid) or pid in seen:
            continue
        seen.add(pid)
        clean.append({
            "id": pid,
            "name": name or pid,
            "created_at": p.get("created_at") or now_iso(),
            "updated_at": p.get("updated_at") or now_iso(),
        })
    if len(clean) != len(data.get("profiles", [])):
        data["profiles"] = clean
        changed = True

    # Migrasi profil lama tunggal
    if not data["profiles"] and LEGACY.exists():
        pid = "default"
        target = STORE / pid / "profile"
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            shutil.move(str(LEGACY), str(target))
        data["profiles"].append({
            "id": pid,
            "name": "Akun Scraping",
            "created_at": now_iso(),
            "updated_at": now_iso(),
        })
        data["active"] = pid
        changed = True

    # Pastikan ada minimal satu profil
    if not data["profiles"]:
        pid = "default"
        (STORE / pid / "profile").mkdir(parents=True, exist_ok=True)
        data["profiles"].append({
            "id": pid,
            "name": "Akun Scraping",
            "created_at": now_iso(),
            "updated_at": now_iso(),
        })
        data["active"] = pid
        changed = True

    active = str(data.get("active") or "")
    ids = {p["id"] for p in data["profiles"]}
    if active not in ids:
        data["active"] = data["profiles"][0]["id"]
        changed = True

    for p in data["profiles"]:
        (STORE / p["id"] / "profile").mkdir(parents=True, exist_ok=True)

    if changed or not INDEX.exists():
        _write_index(data)
    return data


def list_profiles() -> dict:
    data = ensure_store()
    return {
        "active": data["active"],
        "profiles": [dict(p) for p in data["profiles"]],
    }


def get_profile(pid: str) -> dict | None:
    data = ensure_store()
    for p in data["profiles"]:
        if p["id"] == pid:
            return dict(p)
    return None


def active_profile() -> dict:
    data = ensure_store()
    pid = data["active"]
    for p in data["profiles"]:
        if p["id"] == pid:
            return dict(p)
    return dict(data["profiles"][0])


def profile_dir(pid: str | None = None) -> Path:
    data = ensure_store()
    use = pid or data["active"]
    ids = {p["id"] for p in data["profiles"]}
    if use not in ids:
        use = data["active"]
    path = STORE / use / "profile"
    path.mkdir(parents=True, exist_ok=True)
    return path


def create_profile(name: str) -> dict:
    name = str(name or "").strip()
    if not name:
        raise ValueError("Nama profil wajib diisi.")
    if len(name) > 60:
        raise ValueError("Nama profil terlalu panjang (maksimal 60 karakter).")
    data = ensure_store()
    existing = {p["id"] for p in data["profiles"]}
    pid = _unique_id(_slugify(name), existing)
    profile = {"id": pid, "name": name, "created_at": now_iso(), "updated_at": now_iso()}
    (STORE / pid / "profile").mkdir(parents=True, exist_ok=True)
    data["profiles"].append(profile)
    _write_index(data)
    return dict(profile)


def rename_profile(pid: str, name: str) -> dict:
    name = str(name or "").strip()
    if not name:
        raise ValueError("Nama profil wajib diisi.")
    if len(name) > 60:
        raise ValueError("Nama profil terlalu panjang (maksimal 60 karakter).")
    data = ensure_store()
    for p in data["profiles"]:
        if p["id"] == pid:
            p["name"] = name
            p["updated_at"] = now_iso()
            _write_index(data)
            return dict(p)
    raise KeyError("Profil tidak ditemukan.")


def select_profile(pid: str) -> dict:
    data = ensure_store()
    ids = {p["id"] for p in data["profiles"]}
    if pid not in ids:
        raise KeyError("Profil tidak ditemukan.")
    data["active"] = pid
    _write_index(data)
    return active_profile()


def delete_profile(pid: str) -> dict:
    data = ensure_store()
    if len(data["profiles"]) <= 1:
        raise ValueError("Minimal satu profil harus ada.")
    idx = next((i for i, p in enumerate(data["profiles"]) if p["id"] == pid), None)
    if idx is None:
        raise KeyError("Profil tidak ditemukan.")
    removed = data["profiles"].pop(idx)
    if data.get("active") == pid:
        data["active"] = data["profiles"][0]["id"]
    _write_index(data)
    target = STORE / pid
    trash = STORE / ".trash"
    trash.mkdir(parents=True, exist_ok=True)
    if target.exists():
        dest = trash / f"{pid}-{int(time.time())}"
        shutil.move(str(target), str(dest))
    return {"removed": removed, "active": data["active"]}


def session_active(pid: str | None = None) -> bool:
    """Cek cookie sesi Threads pada profil Playwright (tanpa membaca nilainya)."""
    db = profile_dir(pid) / "Default" / "Cookies"
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


def logout_profile(pid: str | None = None) -> dict:
    """Hapus sesi lokal profil. Panggil hanya saat browser/scrape tidak aktif."""
    data = ensure_store()
    use = pid or data["active"]
    if not get_profile(use):
        raise KeyError("Profil tidak ditemukan.")
    pdir = profile_dir(use)
    removed = []
    # Hapus file cookie utama; Chromium juga memakai -journal/wal/shm.
    for base in ("Cookies", "Cookies-journal", "Login Data", "Login Data-journal"):
        f = pdir / "Default" / base
        if f.exists():
            try:
                f.unlink()
                removed.append(base)
            except OSError:
                pass
    # Hapus storage sesi/akun Threads yang umum.
    for rel in [
        "Default/Session Storage",
        "Default/Local Storage",
        "Default/IndexedDB",
        "Default/Service Worker",
        "Default/Sessions",
    ]:
        d = pdir / rel
        if d.exists():
            try:
                shutil.rmtree(d)
                removed.append(rel)
            except OSError:
                pass
    # Bersihkan cookie DB jika masih ada tapi terkunci tidak terjadi.
    db = pdir / "Default" / "Cookies"
    if db.exists():
        try:
            con = sqlite3.connect(str(db), timeout=2)
            try:
                con.execute("delete from cookies where host_key like '%threads.com%'")
                con.commit()
                removed.append("Cookies:threads.com")
            finally:
                con.close()
        except Exception:
            pass
    return {"id": use, "cleared": removed, "active": session_active(use)}
