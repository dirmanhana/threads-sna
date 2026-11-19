#!/usr/bin/env python3
"""Analisis konten berbasis LLM untuk data Threads SNA.

Membaca kredensial dari .env (TIDAK pernah dikirim ke browser), mengirim
komentar ke endpoint Chat Completions, lalu menulis llm_analysis.json yang
dibaca viewer.html untuk sentimen, topik, kata kunci, dan deteksi toksik.

Contoh:
    .venv/bin/python llm_analyze.py
    .venv/bin/python llm_analyze.py --limit 60 --batch-size 20
    .venv/bin/python llm_analyze.py --dry-run      # tanpa panggil API
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SENTIMENTS = {"positif", "negatif", "netral"}
EMOTIONS = {"marah", "senang", "sedih", "sarkas", "netral", "takut", "kagum"}


def load_env(path: Path | None = None) -> dict:
    """Parser .env sederhana (tanpa dependency tambahan)."""
    path = path or ROOT / ".env"
    out: dict[str, str] = {}
    if not Path(path).exists():
        return out
    for raw in Path(path).read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        out[key.strip()] = value.strip().strip('"').strip("'").strip()
    return out


def norm(s) -> str:
    """Samakan dengan normText() di viewer_core.js supaya key cocok."""
    s = str(s or "").lower()
    s = re.sub(r"https?://\S+", " ", s)
    s = re.sub(r"@([\w.]+)", " ", s)
    s = "".join(c if c.isspace() or unicodedata.category(c)[0] in ("L", "N") else " " for c in s)
    return re.sub(r"\s+", " ", s).strip()


def _fnv1a(raw: str, seed: int) -> int:
    h = seed & 0xFFFFFFFF
    for b in raw.encode("utf-8"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def content_key(author, post_code, text) -> str:
    """FNV-1a 64-bit (dua seed) agar bisa dihitung sinkron juga di browser."""
    raw = str(author or "").strip().lower() + "|" + str(post_code or "").strip() + "|" + norm(text)
    return "%08x%08x" % (_fnv1a(raw, 0x811C9DC5), _fnv1a(raw, 0x9E3779B9))


def collect(posts) -> list[dict]:
    """Ambil komentar unik dari replies (thread = lanjutan penulis, dilewati)."""
    seen: set[str] = set()
    out: list[dict] = []
    for p in posts or []:
        code = str((p or {}).get("code") or "")
        for r in (p or {}).get("replies") or []:
            text = str((r or {}).get("text") or "")
            if not text.strip():
                continue
            key = content_key((r or {}).get("author"), code, text)
            if key in seen:
                continue
            seen.add(key)
            out.append({
                "key": key,
                "author": str((r or {}).get("author") or "").strip(),
                "post": code,
                "text": text,
                "timestamp": (r or {}).get("timestamp"),
            })
    return out


def load_posts(path: Path) -> list[dict]:
    data = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    if isinstance(data, list):
        return data
    return data.get("posts", []) if isinstance(data, dict) else []


def parse_json(text: str):
    """Terima JSON murni, JSON dalam code fence, atau objek/array pertama."""
    s = str(text or "").strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s)
        s = re.sub(r"\s*```$", "", s)
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        m = re.search(r"[\[{].*[\]}]", s, re.S)
        if m:
            return json.loads(m.group(0))
        raise ValueError("LLM tidak mengembalikan JSON")


def call_llm(cfg: dict, messages: list[dict], timeout: int) -> str:
    base = str(cfg.get("LLM_BASE_URL", "")).rstrip("/")
    key = str(cfg.get("LLM_API_KEY", ""))
    if not base or not key:
        raise RuntimeError("LLM_BASE_URL / LLM_API_KEY kosong. Isi file .env dulu.")
    url = base + "/chat/completions"
    payload = {
        "model": cfg.get("LLM_MODEL") or "cmd",
        "messages": messages,
        "temperature": 0.2,
        # Model "cmd" di gateway ini adalah model thinking; batasi panjang
        # jawaban supaya tidak menghasilkan penalaran panjang per batch.
        "max_tokens": int(cfg.get("LLM_MAX_TOKENS") or 2500),
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": "Bearer " + key,
            "Content-Type": "application/json",
            "Accept": "application/json",
            # Cloudflare di gateway menolak client tanpa User-Agent browser.
            "User-Agent": ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                           "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"),
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = json.loads(resp.read().decode("utf-8", "replace"))
    try:
        return body["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError("Respons LLM tanpa choices[0].message.content") from exc


def llm_json(cfg: dict, messages: list[dict], timeout: int, retries: int = 2):
    last = None
    for attempt in range(retries + 1):
        try:
            return parse_json(call_llm(cfg, messages, timeout))
        except (urllib.error.URLError, urllib.error.HTTPError, ValueError, RuntimeError, json.JSONDecodeError) as exc:
            last = exc
            if attempt < retries:
                time.sleep(2 * (attempt + 1))
    raise RuntimeError("Gagal memanggil LLM: " + str(last))


def topics_prompt(items: list[dict], count: int) -> list[dict]:
    sample = "\n".join('%d. "%s"' % (i + 1, it["text"][:220].replace("\n", " "))
                       for i, it in enumerate(items))
    return [
        {"role": "system", "content":
            "Kamu adalah analis topik media sosial Indonesia. Jawab HANYA JSON, tanpa markdown."},
        {"role": "user", "content":
            "Kelompokkan komentar Threads berikut ke 4-8 topik yang saling berbeda.\n"
            "Kembalikan JSON array: [{\"id\":0,\"label\":\"nama topik singkat\","
            "\"keywords\":[\"kata kunci 1-3 kata\", ...]}].\n"
            "Gunakan Bahasa Indonesia. Jangan sertakan penjelasan lain.\n\n" + sample},
    ]


def label_prompt(batch: list[dict], topics: list[dict]) -> list[dict]:
    sample = "\n".join('%d. "%s"' % (i + 1, it["text"][:300].replace("\n", " "))
                       for i, it in enumerate(batch))
    topic_list = "; ".join('%d=%s' % (t["id"], t["label"]) for t in topics) or "0=umum"
    return [
        {"role": "system", "content":
            "Kamu adalah analis konten media sosial Indonesia. Jawab HANYA JSON array, tanpa markdown."},
        {"role": "user", "content":
            "Analisis komentar Threads berikut. Beri label pada nomor yang sama persis.\n"
            "sentiment: positif/negatif/netral. emotion: marah/senang/sedih/sarkas/netral/takut/kagum.\n"
            "toxicity: angka 0.0-1.0 (0=aman, 1=ujaran kebencian/ancaman). spam: true jika promosi/"
            "copy-paste tidak substantif. topic: id dari daftar topik.\n"
            "Format: [{\"i\":1,\"sentiment\":\"netral\",\"emotion\":\"netral\",\"toxicity\":0.0,"
            "\"spam\":false,\"topic\":0,\"alasan\":\"maks 80 karakter\"}]\n"
            "Daftar topik: " + topic_list + "\n\nKOMENTAR:\n" + sample},
    ]


def normalize_topics(raw) -> list[dict]:
    if not isinstance(raw, list):
        return []
    out = []
    for i, t in enumerate(raw):
        if not isinstance(t, dict):
            continue
        label = str(t.get("label") or t.get("topic") or ("Topik " + str(i)))[:80]
        kws = t.get("keywords") or t.get("kata_kunci") or []
        if isinstance(kws, str):
            kws = [k.strip() for k in re.split(r"[,;|]", kws)]
        kws = [str(k).strip().lower() for k in kws if str(k).strip()][:8]
        out.append({"id": int(t.get("id", i)) if str(t.get("id", i)).lstrip("-").isdigit() else i,
                    "label": label, "keywords": kws})
    seen, uniq = set(), []
    for t in out:
        if t["id"] in seen:
            continue
        seen.add(t["id"])
        uniq.append(t)
    return uniq[:8]


def normalize_labels(raw, size: int, topic_ids: set[int]) -> dict[int, dict]:
    out: dict[int, dict] = {}
    if not isinstance(raw, list):
        return out
    for row in raw:
        if not isinstance(row, dict):
            continue
        try:
            i = int(row.get("i"))
        except (TypeError, ValueError):
            continue
        if not (1 <= i <= size) or i in out:
            continue
        sent = str(row.get("sentiment") or "").strip().lower()
        if sent not in SENTIMENTS:
            sent = "netral"
        emo = str(row.get("emotion") or "").strip().lower()
        if emo not in EMOTIONS:
            emo = "netral"
        try:
            tox = float(row.get("toxicity", 0))
        except (TypeError, ValueError):
            tox = 0.0
        try:
            topic = int(row.get("topic"))
            if topic not in topic_ids:
                topic = sorted(topic_ids)[0] if topic_ids else 0
        except (TypeError, ValueError):
            topic = sorted(topic_ids)[0] if topic_ids else 0
        out[i] = {
            "sentiment": sent,
            "emotion": emo,
            "toxicity": round(max(0.0, min(1.0, tox)), 3),
            "spam": bool(row.get("spam")),
            "topic": topic,
            "alasan": str(row.get("alasan") or "")[:120],
        }
    return out


def analyze(cfg: dict, items: list[dict], batch_size: int, timeout: int,
            with_topics: bool = True, on_progress=None) -> dict:
    topics: list[dict] = []
    if with_topics and items:
        sample = sorted(items, key=lambda x: len(x["text"]), reverse=True)[:120]
        try:
            topics = normalize_topics(llm_json(cfg, topics_prompt(sample, len(sample)), timeout))
        except Exception as exc:  # topik gagal tidak boleh menggagalkan sentimen
            print("Peringatan: topik gagal dibuat (%s); lanjut tanpa topik." % exc, file=sys.stderr)
    topic_ids = {t["id"] for t in topics} or {0}

    labels: dict[str, dict] = {}
    chunks = [items[i:i + batch_size] for i in range(0, len(items), batch_size)]
    for n, batch in enumerate(chunks, 1):
        result = normalize_labels(
            llm_json(cfg, label_prompt(batch, topics), timeout), len(batch), topic_ids)
        for i, it in enumerate(batch, 1):
            if i in result:
                labels[it["key"]] = result[i]
        if on_progress:
            on_progress(n, len(chunks), len(labels))
        elif n % 5 == 0 or n == len(chunks):
            print("  batch %d/%d" % (n, len(chunks)), file=sys.stderr)

    counts = {t["id"]: 0 for t in topics}
    for v in labels.values():
        counts[v["topic"]] = counts.get(v["topic"], 0) + 1
    for t in topics:
        t["count"] = counts.get(t["id"], 0)
    keywords = []
    for t in topics:
        for kw in t["keywords"]:
            keywords.append({"term": kw, "topic": t["id"], "count": t["count"]})
    keywords.sort(key=lambda x: (-x["count"], x["term"]))

    return {
        "schema": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "model": cfg.get("LLM_MODEL") or "cmd",
        "counts": {"comments": len(items), "labeled": len(labels), "topics": len(topics)},
        "topics": topics,
        "keywords": keywords,
        "comments": labels,
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Analisis konten Threads via LLM")
    ap.add_argument("--project", default="", help="slug proyek di projects/<slug>/ (opsional)")
    ap.add_argument("--in", dest="inp", default="")
    ap.add_argument("--out", default="")
    ap.add_argument("--env", default=str(ROOT / ".env"))
    ap.add_argument("--limit", type=int, default=0, help="batasi jumlah komentar (0=semua)")
    ap.add_argument("--batch-size", type=int, default=0)
    ap.add_argument("--timeout", type=int, default=0)
    ap.add_argument("--no-topic", action="store_true")
    ap.add_argument("--progress-file", default="",
                    help="tulis progres batch ke file JSON (dipakai server lokal)")
    ap.add_argument("--dry-run", action="store_true", help="tampilkan rencana tanpa panggil API")
    a = ap.parse_args(argv)

    if a.project:
        try:
            import projects as project_store
            if not project_store.get_project(a.project):
                print("Proyek tidak ditemukan: %s" % a.project, file=sys.stderr)
                return 1
            paths = project_store.paths(a.project)
            a.inp = a.inp or str(paths["data"])
            a.out = a.out or str(paths["analysis"])
            a.progress_file = a.progress_file or str(paths["llm_progress"])
        except ValueError as exc:
            print("Proyek tidak valid: %s" % exc, file=sys.stderr)
            return 1
    a.inp = a.inp or str(ROOT / "data.json")
    a.out = a.out or str(ROOT / "llm_analysis.json")

    cfg = load_env(Path(a.env))
    cfg = {k: (os.environ.get(k) or v) for k, v in cfg.items()}
    batch = int(a.batch_size or cfg.get("LLM_BATCH_SIZE") or 40)
    timeout = int(a.timeout or cfg.get("LLM_TIMEOUT") or 90)
    items = collect(load_posts(Path(a.inp)))
    if a.limit > 0:
        items = items[:a.limit]

    if a.dry_run:
        print("model=%s base=%s" % (cfg.get("LLM_MODEL") or "cmd",
                                   cfg.get("LLM_BASE_URL") or "(kosong)"))
        print("komentar=%d batch=%d jumlah_panggilan≈%d" %
              (len(items), batch, 1 + (len(items) + batch - 1) // batch))
        print("kredensial: " + ("ada" if cfg.get("LLM_API_KEY") else "TIDAK ADA (isi .env)"))
        return 0

    if not items:
        print("Tidak ada komentar untuk dianalisis.", file=sys.stderr)
        return 1
    print("Menganalisis %d komentar dengan %s …" % (len(items), cfg.get("LLM_MODEL") or "cmd"),
          file=sys.stderr)

    def progress(n, total, labeled):
        if a.progress_file:
            Path(a.progress_file).write_text(
                json.dumps({"done": n, "total": total, "labeled": labeled}), encoding="utf-8")
        else:
            print("  batch %d/%d" % (n, total), file=sys.stderr)

    result = analyze(cfg, items, batch, timeout, with_topics=not a.no_topic,
                     on_progress=progress if a.progress_file else None)
    out = Path(a.out)
    tmp = out.with_suffix(out.suffix + ".tmp")
    tmp.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(out)
    print("Selesai: %s (%d label, %d topik)" %
          (out.name, result["counts"]["labeled"], result["counts"]["topics"]), file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
