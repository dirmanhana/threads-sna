#!/usr/bin/env python3
"""Penyimpanan data per proyek.

Satu proyek = satu folder di `projects/<slug>/`:

    meta.json               nama, slug, waktu dibuat/diperbarui
    data.json               postingan + komentar
    llm_analysis.json       hasil analisis LLM (opsional)
    failed.json             URL yang gagal (opsional)
    scrape_progress.json    progres scraping (sementara)
    llm_progress.json       progres analisis LLM (sementara)

Modul ini sengaja tidak bergantung pada Playwright atau server, supaya bisa
dipakai scraper, server, dan tes. Semua penulisan JSON dilakukan atomik.
"""
from __future__ import annotations

import json
import re
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROJECTS = ROOT / "projects"
LEGACY_DATA = ROOT / "data.json"
LEGACY_ANALYSIS = ROOT / "llm_analysis.json"
LEGACY_FAILED = ROOT / "failed.json"
TRASH = PROJECTS / ".trash"

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")
FILE_NAMES = {
    "meta": "meta.json",
    "data": "data.json",
    "analysis": "llm_analysis.json",
    "failed": "failed.json",
    "progress": "scrape_progress.json",
    "llm_progress": "llm_progress.json",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def valid_slug(slug: str) -> bool:
    return bool(SLUG_RE.fullmatch(str(slug or "")))


def slugify(name: str) -> str:
    """Nama proyek -> slug aman: huruf kecil, angka, dan tanda hubung."""
    text = str(name or "").strip().lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    text = text[:40].strip("-")
    if not text or not text[0].isalnum():
        text = "proyek-" + text if text else "proyek"
    return text


def project_dir(slug: str) -> Path:
    """Folder proyek; menolak slug tidak valid/path traversal."""
    if not valid_slug(slug):
        raise ValueError("Slug proyek tidak valid.")
    base = PROJECTS.resolve()
    path = (PROJECTS / slug).resolve()
    if path.parent != base:
        raise ValueError("Slug proyek tidak valid.")
    return path


def paths(slug: str) -> dict[str, Path]:
    d = project_dir(slug)
    return {key: d / name for key, name in FILE_NAMES.items()}


def read_json(path: Path, fallback=None):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8-sig"))
    except Exception:
        return fallback


def atomic_write(path: Path, data) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def read_index() -> dict:
    data = read_json(PROJECTS / "index.json", {})
    if not isinstance(data, dict):
        return {"version": 1, "projects": []}
    projects = data.get("projects")
    if not isinstance(projects, list):
        projects = []
    return {"version": 1, "projects": projects}


def write_index(items: list[dict]) -> None:
    PROJECTS.mkdir(parents=True, exist_ok=True)
    atomic_write(PROJECTS / "index.json", {
        "version": 1,
        "updated_at": now_iso(),
        "projects": items,
    })


def _meta_for(slug: str) -> dict:
    p = paths(slug)
    meta = read_json(p["meta"], {})
    if not isinstance(meta, dict):
        meta = {}
    data = p["data"]
    info = {
        "slug": slug,
        "name": str(meta.get("name") or slug),
        "created_at": meta.get("created_at"),
        "updated_at": meta.get("updated_at"),
        "posts": 0,
        "size": data.stat().st_size if data.exists() else 0,
        "mtime": data.stat().st_mtime if data.exists() else None,
        "has_analysis": p["analysis"].exists(),
        "has_data": data.exists(),
    }
    if data.exists():
        payload = read_json(data, {})
        posts = payload.get("posts") if isinstance(payload, dict) else payload
        if isinstance(posts, list):
            info["posts"] = len(posts)
    return info


def list_projects() -> list[dict]:
    """Daftar proyek dari isi folder, diurutkan dari yang terbaru diperbarui."""
    PROJECTS.mkdir(parents=True, exist_ok=True)
    items = []
    for entry in PROJECTS.iterdir():
        if not entry.is_dir() or entry.name.startswith("."):
            continue
        if not valid_slug(entry.name):
            continue
        try:
            items.append(_meta_for(entry.name))
        except (OSError, ValueError):
            continue
    items.sort(key=lambda x: (x.get("updated_at") or "", x.get("name") or ""), reverse=True)
    return items


def get_project(slug: str) -> dict | None:
    if not valid_slug(slug):
        return None
    if not project_dir(slug).is_dir():
        return None
    return _meta_for(slug)


def _sync_index() -> None:
    write_index([
        {"slug": p["slug"], "name": p["name"], "created_at": p["created_at"],
         "updated_at": p["updated_at"]}
        for p in list_projects()
    ])


def _empty_data() -> dict:
    return {"schema_version": 2, "generated_at": now_iso(), "posts": []}


def create_project(name: str, slug: str | None = None) -> dict:
    """Buat proyek baru. Slug otomatis dibuat unik bila sudah dipakai."""
    name = str(name or "").strip()
    if not (1 <= len(name) <= 80):
        raise ValueError("Nama proyek harus 1–80 karakter.")
    base = str(slug or "").strip() or slugify(name)
    if not valid_slug(base):
        raise ValueError("Slug hanya boleh huruf kecil, angka, dan tanda hubung.")
    PROJECTS.mkdir(parents=True, exist_ok=True)

    candidate = base
    for i in range(2, 100):
        if not project_dir(candidate).exists():
            break
        candidate = f"{base}-{i}"[:41].strip("-")
    else:
        raise ValueError("Terlalu banyak proyek dengan slug serupa.")

    d = project_dir(candidate)
    d.mkdir(parents=True, exist_ok=False)
    created = now_iso()
    meta = {"slug": candidate, "name": name, "created_at": created, "updated_at": created}
    p = paths(candidate)
    atomic_write(p["meta"], meta)
    if not p["data"].exists():
        atomic_write(p["data"], _empty_data())
    _sync_index()
    return _meta_for(candidate)


def rename_project(slug: str, name: str) -> dict:
    name = str(name or "").strip()
    if not (1 <= len(name) <= 80):
        raise ValueError("Nama proyek harus 1–80 karakter.")
    p = paths(slug)
    if not p["meta"].exists():
        raise FileNotFoundError("Proyek tidak ditemukan.")
    meta = read_json(p["meta"], {})
    meta["name"] = name
    meta["updated_at"] = now_iso()
    atomic_write(p["meta"], meta)
    _sync_index()
    return _meta_for(slug)


def delete_project(slug: str) -> dict:
    """Pindahkan proyek ke .trash (bukan hapus permanen)."""
    if not valid_slug(slug):
        raise ValueError("Slug proyek tidak valid.")
    d = project_dir(slug)
    if not d.is_dir():
        raise FileNotFoundError("Proyek tidak ditemukan.")
    remaining = [p for p in list_projects() if p["slug"] != slug]
    if not remaining:
        raise ValueError("Tidak bisa menghapus satu-satunya proyek.")
    TRASH.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    target = TRASH / f"{slug}-{stamp}"
    n = 2
    while target.exists():
        target = TRASH / f"{slug}-{stamp}-{n}"
        n += 1
    shutil.move(str(d), str(target))
    _sync_index()
    return {"slug": slug, "trashed": str(target.relative_to(ROOT))}


def ensure_default_project() -> dict | None:
    """Migrasikan data.json lama ke proyek `default` bila belum ada proyek.

    File lama tidak dihapus; hanya disalin. Dengan begitu pengguna masih punya
    cadangan dan bisa memeriksa hasil migrasi.
    """
    PROJECTS.mkdir(parents=True, exist_ok=True)
    existing = [p for p in PROJECTS.iterdir()
                if p.is_dir() and not p.name.startswith(".") and valid_slug(p.name)]
    if existing:
        return None

    slug = "default"
    d = project_dir(slug)
    d.mkdir(parents=True, exist_ok=True)
    created = now_iso()
    atomic_write(paths(slug)["meta"], {
        "slug": slug, "name": "Proyek Default",
        "created_at": created, "updated_at": created,
    })
    p = paths(slug)
    copied = []
    for src, key in ((LEGACY_DATA, "data"), (LEGACY_ANALYSIS, "analysis"),
                     (LEGACY_FAILED, "failed")):
        if src.exists() and not p[key].exists():
            shutil.copy2(src, p[key])
            copied.append(key)
    if not p["data"].exists():
        atomic_write(p["data"], _empty_data())
    _sync_index()
    info = _meta_for(slug)
    info["migrated"] = copied
    return info
