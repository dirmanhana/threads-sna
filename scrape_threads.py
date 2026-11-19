"""
Scraper Threads untuk SNA (Playwright, tanpa API).

Setup:
    pip install playwright && playwright install chromium

Pakai (lebih mudah lewat ./run.sh, lihat README):
    python scrape_threads.py login                              # sekali saja, login manual di browser
    python scrape_threads.py profile akun_target --max-posts 10  # ambil N postingan terbaru + komentarnya
    python scrape_threads.py keyword "kata kunci" --max-posts 15 # cari postingan berdasarkan kata kunci
    python scrape_threads.py post https://www.threads.com/@akun/post/XXXX

Hasil: data.json (hasil baru digabung dengan yang lama). Skema satu postingan:
    {
      code, url, author, text,             # text = isi post + gabungan thread
      timestamp, likes,                    # bisa null
      thread:  [{code, author, text, timestamp, likes, parent_code}],  # lanjutan oleh penulis
      replies: [{code, author, text, timestamp, likes, parent_code}],  # komentar orang lain
      scraped_at
    }
"""
import argparse, json, math, os, random, re, time
from datetime import datetime, timezone
from urllib.parse import quote
from playwright.sync_api import sync_playwright

BASE = "https://www.threads.com"
PROFILE_DIR = "./threads_profile"   # sesi login disimpan di sini
OUT = "data.json"
FAILED = "failed.json"
LINK_RE = re.compile(r"/@([^/]+)/post/([\w-]+)")

# Cari semua link /@user/post/KODE, naik ke container terbesar yang hanya memuat 1 postingan.
# `parent` adalah heuristik best-effort untuk balasan bersarang: kode lain yang muncul
# lebih awal di dokumen di dalam ancestor terdekat dianggap induk (cuplikan quote reply).
JS_EXTRACT = """() => {
  const out = [], seen = new Set();
  const links = [...document.querySelectorAll('a[href*="/post/"]')];
  const codes = el => new Set(links
      .filter(a => el.contains(a))
      .map(a => (a.getAttribute('href').match(/\\/post\\/([\\w-]+)/) || [])[1]).filter(Boolean));
  links.forEach(a => {
    const m = (a.getAttribute('href') || '').match(/^\\/@([^/]+)\\/post\\/([\\w-]+)/);
    if (!m || seen.has(m[2])) return;
    seen.add(m[2]);
    let c = a;
    while (c.parentElement && c.parentElement !== document.body &&
           (c.parentElement.innerText || '').length <= 8000 &&
           codes(c.parentElement).size <= 1) c = c.parentElement;
    let parent = null, p = c.parentElement;
    for (let k = 0; k < 4 && p; k++, p = p.parentElement) {
      const others = [...codes(p)].filter(x => x !== m[2]);
      for (const cand of others) {
        const other = links.find(l => (l.getAttribute('href') || '').includes('/post/' + cand));
        if (other && (other.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING)) {
          parent = cand; break;
        }
      }
      if (parent) break;
    }
    const text = c.innerText || '';
    const lk = text.match(/([\\d.,]+)\\s*(?:rb|ribu|jt|juta|k|m)?\\s*(?:suka|likes)\\b/i);
    out.push({author: m[1], code: m[2], lines: text.split('\\n'),
              likes: lk ? lk[1] : null, parent: parent});
  });
  return out;
}"""

DATE_RE = re.compile(r"(?<!\d)(\d{1,2})/(\d{1,2})/(\d{4})(?!\d)")
VIEWS_RE = re.compile(r"[\d.,]+\s*(?:rb|ribu|jt|juta|k|m)?\s*(?:tayangan|views?)\b", re.I)
LIKES_RE = re.compile(r"([\d.,]+)\s*(rb|ribu|jt|juta|k|m)?\s*(?:suka|likes?)\b", re.I)
NOISE = re.compile(
    r"^(\d+\s?(s|m|h|d|w|j|mnt|detik|menit|jam|hari|minggu)|[\d.,]+[KkMm]?|"
    r"Terjemahkan|Translate|Balas|Reply|Thread|Threads|Suka|Like|Lihat aktivitas|View activity|•|/|Penulis|Author)$"
)
MULT = {"k": 1_000, "rb": 1_000, "ribu": 1_000, "jt": 1_000_000, "juta": 1_000_000, "m": 1_000_000}


def parse_num(raw, unit=None):
    """Ubah '99,3 rb' / '1.234' jadi int. Format Indonesia: koma desimal, titik ribuan."""
    if raw is None:
        return None
    s = str(raw).strip()
    try:
        if re.fullmatch(r"\d{1,3}(?:\.\d{3})+", s):
            n = float(s.replace(".", ""))
        else:
            n = float(s.replace(",", "."))
    except ValueError:
        return None
    return int(round(n * MULT.get((unit or "").lower(), 1)))


def to_iso(d, m, y):
    """dd/mm/yyyy -> yyyy-mm-dd (None kalau tanggal tidak valid)."""
    try:
        return datetime(int(y), int(m), int(d)).strftime("%Y-%m-%d")
    except ValueError:
        return None


def parse_item(lines, author, likes_hint=None):
    """Bersihkan satu item (post/reply) -> (teks, timestamp, likes)."""
    keep, ts, likes = [], None, likes_hint
    for raw in lines or []:
        s = (raw or "").strip()
        if not s or s == author:
            continue
        md = DATE_RE.fullmatch(s)
        if md:
            ts = ts or to_iso(*md.groups())
            continue
        if VIEWS_RE.fullmatch(s) or NOISE.match(s):
            continue
        ml = LIKES_RE.search(s)
        if ml and len(s) <= 24:
            likes = likes or parse_num(ml.group(1), ml.group(2))
            s = LIKES_RE.sub("", s).strip()
            if not s:
                continue
        s = VIEWS_RE.sub("", s).strip()
        s = DATE_RE.sub("", s).strip(" \n\t-•|")
        if s and not NOISE.match(s):
            keep.append(s)
    return "\n".join(keep), ts, likes


def clean(lines, author):
    """Kompatibel dengan pemanggil lama: hanya teks bersih."""
    return parse_item(lines, author)[0]


def normalize_post(p):
    """Pastikan schema baru ada walaupun data lama dibaca."""
    q = dict(p)
    q.setdefault("thread", [])
    q.setdefault("replies", [])
    q.setdefault("timestamp", None)
    q.setdefault("likes", None)
    q.setdefault("scraped_at", None)
    for key in ("replies", "thread"):
        for r in q.get(key, []):
            r.setdefault("timestamp", None)
            r.setdefault("likes", None)
            r.setdefault("parent_code", None)
    return q


def scroll_collect(page, rounds, store, stall=3, cap=None):
    """Scroll & kumpulkan item; berhenti lebih awal kalau tidak ada item baru."""
    idle = 0
    for _ in range(rounds):
        before = len(store)
        for it in page.evaluate(JS_EXTRACT):
            store.setdefault(it["code"], it)
        if cap and len(store) >= cap:
            break
        idle = idle + 1 if len(store) == before else 0
        if idle >= stall:
            break
        page.mouse.wheel(0, 2500)
        page.wait_for_timeout(random.randint(1000, 1800))
    return store


def get_profile_posts(page, handle, max_posts):
    page.goto(f"{BASE}/@{handle}", wait_until="domcontentloaded")
    page.wait_for_timeout(3000)
    store = {}
    for _ in range(max(3, max_posts)):
        scroll_collect(page, 1, store, stall=1)
        mine = [c for c, v in store.items() if v["author"].lower() == handle.lower()]
        if len(mine) >= max_posts:
            break
    return [f"{BASE}/@{store[c]['author']}/post/{c}" for c in mine][:max_posts]


def get_keyword_posts(page, query, max_posts):
    page.goto(f"{BASE}/search?q={quote(query)}&serp_type=default", wait_until="domcontentloaded")
    page.wait_for_timeout(3500)
    store = {}
    for _ in range(max(3, max_posts)):
        scroll_collect(page, 1, store, stall=1)
        if len(store) >= max_posts:
            break
    return [f"{BASE}/@{v['author']}/post/{c}" for c, v in store.items()][:max_posts]


def scrape_post(page, url, max_replies=400):
    m = LINK_RE.search(url)
    if not m:
        raise ValueError(f"URL postingan tidak dikenali: {url}")
    code = m.group(2)
    page.goto(url, wait_until="domcontentloaded")
    page.wait_for_timeout(3000)
    store = {}
    scroll_collect(page, max(8, math.ceil(max_replies / 40)), store, stall=3, cap=max_replies + 1)
    main = store.get(code)
    if not main:
        return None                      # bisa berarti login kedaluwarsa / selector berubah

    main_text, main_ts, main_likes = parse_item(
        main["lines"], main["author"], main.get("likes"))
    thread, replies = [], []
    for c, v in store.items():
        if c == code:
            continue
        text, ts, likes = parse_item(v["lines"], v["author"], v.get("likes"))
        if not text:
            continue
        item = {"code": c, "author": v["author"], "text": text,
                "timestamp": ts, "likes": likes, "parent_code": v.get("parent")}
        if v["author"].lower() == main["author"].lower():
            thread.append(item)          # lanjutan thread, bukan komentar
        else:
            replies.append(item)
        if len(replies) >= max_replies:
            break

    body = main_text
    if thread:
        body = (body + "\n\n" if body else "") + "\n".join(t["text"] for t in thread)
    return {"code": code, "url": url, "author": main["author"], "text": body,
            "timestamp": main_ts or (thread[0]["timestamp"] if thread else None),
            "likes": main_likes, "thread": thread, "replies": replies,
            "scraped_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}


def load_posts(path):
    if not os.path.exists(path):
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return {p["code"]: normalize_post(p) for p in data.get("posts", [])}
    except (OSError, ValueError, KeyError, TypeError) as e:
        print("! gagal membaca", path, "-", e)
        return {}


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["login", "profile", "keyword", "post"])
    ap.add_argument("target", nargs="?")
    ap.add_argument("--max-posts", type=int, default=10)
    ap.add_argument("--max-replies", type=int, default=400, help="batas komentar per postingan")
    ap.add_argument("--out", default=OUT, help="file hasil (default: data.json)")
    ap.add_argument("--delay", type=float, default=3.0, help="jeda dasar antar postingan (detik)")
    ap.add_argument("--profile-dir", default=PROFILE_DIR, help="direktori sesi login")
    ap.add_argument("--show", action="store_true", help="tampilkan browser")
    a = ap.parse_args()

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            a.profile_dir, headless=not (a.show or a.mode == "login"), locale="id-ID")
        page = ctx.pages[0] if ctx.pages else ctx.new_page()

        if a.mode == "login":
            page.goto(f"{BASE}/login")
            input("Login dulu di browser, lalu tekan Enter di sini... ")
            ctx.close()
            return

        if a.mode == "profile":
            urls = get_profile_posts(page, a.target.lstrip("@"), a.max_posts)
        elif a.mode == "keyword":
            urls = get_keyword_posts(page, a.target, a.max_posts)
        else:
            urls = [a.target]
        print(f"{len(urls)} postingan akan diambil")

        posts = load_posts(a.out)
        failed, ok = [], 0
        for i, u in enumerate(urls, 1):
            r = None
            for attempt in range(1, 3):
                try:
                    r = scrape_post(page, u, a.max_replies)
                    if r:
                        break
                except Exception as e:                       # noqa: BLE001 - lanjut ke retry
                    print(f"  ! percobaan {attempt} gagal: {e}")
                time.sleep(1.5 * attempt)
            if r:
                posts[r["code"]] = r
                ok += 1
                print(f"[{i}/{len(urls)}] @{r['author']}: "
                      f"{len(r['replies'])} komentar · {len(r['thread'])} thread")
            else:
                failed.append({"url": u, "time": datetime.now(timezone.utc).isoformat(timespec="seconds")})
                print(f"[{i}/{len(urls)}] ! gagal: {u}")
            if i < len(urls):
                time.sleep(max(0.2, a.delay * random.uniform(0.7, 1.3)))

        if failed:
            old = []
            if os.path.exists(FAILED):
                try:
                    old = json.load(open(FAILED, encoding="utf-8"))
                except (OSError, ValueError):
                    old = []
            seen = {x["url"] for x in old}
            save_json(FAILED, old + [x for x in failed if x["url"] not in seen])
            print("URL gagal dicatat ke", FAILED)
        if ok or not failed:
            save_json(a.out, {"posts": list(posts.values())})
            print("Tersimpan ke", a.out)
        else:
            print("Tidak ada hasil baru; file hasil tidak ditimpa.")
            print("Jika semua postingan gagal, kemungkinan sesi login kedaluwarsa. "
                  "Jalankan: ./run.sh login (atau periksa selector JS_EXTRACT).")
        ctx.close()


if __name__ == "__main__":
    main()
