"""
Migrasi data.json lama ke schema baru.

- Memisahkan lanjutan thread (penulis postingan) dari komentar
- Membuang metadata tanggal / "rb tayangan" / "suka" dari teks
- Mengisi field timestamp, likes, parent_code, scraped_at (bisa null)
- Aman dijalankan ulang (idempotent); backup disimpan ke data.json.bak

Pakai: .venv/bin/python migrate_data.py [--src data.json]
"""
import argparse, json, os, shutil
from datetime import datetime, timezone

from scrape_threads import normalize_post, parse_item


def migrate_item(r):
    """Normalisasi satu reply/thread lama."""
    q = dict(r)
    text, ts, likes = parse_item(
        (q.get("text") or "").split("\n"), q.get("author", ""), q.get("likes"))
    q["text"] = text
    q["timestamp"] = q.get("timestamp") or ts
    q["likes"] = likes if likes is not None else q.get("likes")
    q.setdefault("parent_code", None)
    return q


def migrate(src="data.json", bak="data.json.bak"):
    if not os.path.exists(src):
        print("Tidak ada", src, "- tidak ada yang dimigrasi.")
        return
    if not os.path.exists(bak):
        shutil.copy2(src, bak)
        print("Backup dibuat:", bak)

    with open(src, encoding="utf-8") as f:
        data = json.load(f)

    posts = []
    for raw in data.get("posts", []):
        p = normalize_post(raw)
        author = p.get("author", "")
        main_text, main_ts, main_likes = parse_item(
            (p.get("text") or "").split("\n"), author, p.get("likes"))

        existing_thread = [migrate_item(t) for t in p.get("thread", [])]
        thread, replies = list(existing_thread), []
        for r in p.get("replies", []):
            item = migrate_item(r)
            if not item["text"].strip():
                continue
            if item.get("author", "").lower() == author.lower():
                thread.append(item)
            else:
                replies.append(item)

        body = main_text
        if len(thread) > len(existing_thread):            # hanya yang baru dipindahkan
            extra = "\n".join(t["text"] for t in thread[len(existing_thread):]).strip()
            if extra:
                body = (body + "\n\n" if body else "") + extra

        posts.append({
            "code": p["code"], "url": p.get("url", ""), "author": author,
            "text": body,
            "timestamp": (main_ts or p.get("timestamp") or
                          (thread[0]["timestamp"] if thread else None)),
            "likes": main_likes if main_likes is not None else p.get("likes"),
            "thread": thread, "replies": replies,
            "scraped_at": p.get("scraped_at") or datetime.now(timezone.utc).isoformat(timespec="seconds"),
        })

    with open(src, "w", encoding="utf-8") as f:
        json.dump({"posts": posts}, f, ensure_ascii=False, indent=2)

    print(f"{len(posts)} postingan dimigrasi.")
    print("  komentar:", sum(len(p["replies"]) for p in posts))
    print("  thread:  ", sum(len(p["thread"]) for p in posts))
    print("  bertanggal:", sum(1 for p in posts for r in p["replies"] if r["timestamp"]))
    print("  teks post kosong:", sum(1 for p in posts if not p["text"].strip()))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="data.json")
    ap.add_argument("--bak", default="data.json.bak")
    a = ap.parse_args()
    migrate(a.src, a.bak)
