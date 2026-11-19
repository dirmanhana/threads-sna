"""
Scraper Threads untuk SNA (Playwright, tanpa API).

Setup:
    pip install playwright && playwright install chromium

Pakai (lebih mudah lewat ./run.sh, lihat README):
    python scrape_threads.py login                              # sekali saja, login manual di browser
    python scrape_threads.py profile akun_target --max-posts 10  # ambil N postingan terbaru + komentarnya
    python scrape_threads.py keyword "kata kunci" --max-posts 15 # cari postingan berdasarkan kata kunci
    python scrape_threads.py post https://www.threads.com/@akun/post/XXXX

Dipicu dari halaman web (/scrape.html): mode `web-login` membuka Chromium
tanpa input(), dan flag --web/--progress-file/--replace dipakai llm_server.py.

Hasil: data.json (hasil baru digabung dengan yang lama, kecuali --replace).
Skema satu postingan:
    {
      code, url, author, text,             # text = isi post + gabungan thread
      timestamp, likes,                    # bisa null
      thread:  [{code, author, text, timestamp, likes, parent_code}],  # lanjutan oleh penulis
      replies: [{code, author, text, timestamp, likes, parent_code}],  # komentar orang lain
      scraped_at
    }
"""
import argparse, json, math, os, random, re, shutil, sys, time
from datetime import datetime, timezone, timedelta
from urllib.parse import quote
from playwright.sync_api import sync_playwright

BASE = "https://www.threads.com"
PROFILE_DIR = "./threads_profile"   # sesi login disimpan di sini
OUT = "data.json"
FAILED = "failed.json"
PROGRESS = "scrape_progress.json"
LOGIN_MARKER = "login_selesai.marker"
LINK_RE = re.compile(r"/@([^/]+)/post/([\w-]+)")
SESSION_COOKIES = ("sessionid", "ds_user_id")   # cookie=.threads.com hasil login

# Saat dipicu dari web, semua log lewat stderr supaya llm_server.py bisa
# mengumpulkannya dan menampilkannya di halaman "Pengumpulan Data".
def log(*args):
    print(*args, file=sys.stderr, flush=True)


def write_progress(path, phase, done=0, total=0, message="", **extra):
    """Tulis status job secara atomik supaya pembaca (server/browser) tidak melihat JSON setengah jadi."""
    if not path:
        return
    data = {"phase": phase, "done": int(done), "total": int(total), "message": str(message)}
    data.update(extra)
    tmp = str(path) + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(tmp, path)
    except OSError:
        pass

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
    for (let k = 0; k < 12 && p; k++, p = p.parentElement) {
      const others = [...codes(p)].filter(x => x !== m[2]);
      for (const cand of others) {
        const other = links.find(l => (l.getAttribute('href') || '').includes('/post/' + cand));
        if (other && (other.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING)) {
          parent = cand; break;
        }
      }
      if (parent) break;
    }
    const timeEl = c.querySelector('time[datetime]');
    const text = c.innerText || '';
    const lk = text.match(/([\\d.,]+)\\s*(?:rb|ribu|jt|juta|k|m)?\\s*(?:suka|likes)\\b/i);
    out.push({author: m[1], code: m[2], lines: text.split('\\n'),
              likes: lk ? lk[1] : null, parent: parent,
              dt: timeEl ? timeEl.getAttribute('datetime') : null});
  });
  return out;
}"""

DATE_RE = re.compile(r"(?<!\d)(\d{1,2})/(\d{1,2})/(\d{4})(?!\d)")
DATETIME_RE = re.compile(
    r"^(\d{1,2})/(\d{1,2})/(\d{4})[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?$", re.I)
REL_RE = re.compile(
    r"^(\d+)\s*(s|m|h|d|w|y|j|mnt|detik|menit|jam|hari|minggu|mgg|hr|bln|thn)(?:\s+yang\s+lalu)?$", re.I)
JUST_NOW_RE = re.compile(r"^(baru saja|just now|sekarang)$", re.I)
REPLY_HINT_RE = re.compile(
    r"^(?:(?:lihat|tampilkan|view|show|more)\s+)?(\d+)\s*(?:balasan|replies?|reply)$", re.I)
VIEWS_RE = re.compile(r"[\d.,]+\s*(?:rb|ribu|jt|juta|k|m)?\s*(?:tayangan|views?)\b", re.I)
LIKES_RE = re.compile(r"([\d.,]+)\s*(rb|ribu|jt|juta|k|m)?\s*(?:suka|likes?)\b", re.I)
NOISE = re.compile(
    r"^(\d+\s?(s|m|h|d|w|j|mnt|detik|menit|jam|hari|minggu)|[\d.,]+[KkMm]?|"
    r"Terjemahkan|Translate|Balas|Reply|Thread|Threads|Suka|Like|Lihat aktivitas|View activity|•|/|Penulis|Author)$"
)
MULT = {"k": 1_000, "rb": 1_000, "ribu": 1_000, "jt": 1_000_000, "juta": 1_000_000, "m": 1_000_000}
REL_SECONDS = {
    "s": 1, "detik": 1, "m": 60, "mnt": 60, "menit": 60,
    "h": 3_600, "j": 3_600, "jam": 3_600, "hr": 3_600,
    "d": 86_400, "hari": 86_400, "w": 604_800, "minggu": 604_800, "mgg": 604_800,
    "bln": 2_592_000, "thn": 31_536_000, "y": 31_536_000,
}


def iso_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def epoch_to_iso(value):
    """Epoch detik/milidetik/ISO string -> ISO 8601 UTC, atau None."""
    if value is None or value == "":
        return None
    try:
        if isinstance(value, str) and not re.fullmatch(r"\d+(?:\.\d+)?", value.strip()):
            dt = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc).isoformat(timespec="seconds")
        n = float(value)
        if n > 1e12:
            n /= 1000.0
        if not (946684800 <= n <= 4102444800):   # 2000-01-01 .. 2100-01-01
            return None
        return datetime.fromtimestamp(n, timezone.utc).isoformat(timespec="seconds")
    except (TypeError, ValueError, OSError, OverflowError):
        return None


def normalize_dom_datetime(value):
    """Nilai <time datetime="..."> -> (ISO/date, sumber)."""
    if not value:
        return None, None
    s = str(value).strip()
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None, None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.now().astimezone().tzinfo)
    iso = dt.astimezone(timezone.utc).isoformat(timespec="seconds")
    if len(s) <= 10 and dt.hour == 0 and dt.minute == 0 and dt.second == 0:
        return iso[:10], "date"
    return iso, "dom"


class TimestampCollector:
    """Kumpulkan timestamp dari respons JSON internal Threads (best-effort).

    Threads merender waktu di DOM, tetapi respons JSON biasanya membawa
    `taken_at`/`created_at` yang jauh lebih presisi. Kolektor ini tidak
    menggagalkan scraping bila format respons berubah.
    """

    MAX_BYTES = 5 * 1024 * 1024
    MAX_NODES = 200_000

    def __init__(self):
        self.by_code = {}
        self._nodes = 0

    def attach(self, page):
        page.on("response", self._on_response)

    def _on_response(self, response):
        try:
            if response.request.resource_type not in ("xhr", "fetch"):
                return
            headers = response.headers or {}
            ctype = (headers.get("content-type") or "").lower()
            if "json" not in ctype:
                return
            try:
                if int(headers.get("content-length") or 0) > self.MAX_BYTES:
                    return
            except ValueError:
                pass
            self._nodes = 0
            self._walk(response.json())
        except Exception:
            return

    def _walk(self, obj, depth=0):
        if depth > 40 or self._nodes > self.MAX_NODES:
            return
        self._nodes += 1
        if isinstance(obj, dict):
            code = obj.get("code") or obj.get("shortcode")
            stamp = (obj.get("taken_at") or obj.get("taken_at_ms")
                     or obj.get("created_at") or obj.get("device_timestamp")
                     or obj.get("timestamp"))
            iso = epoch_to_iso(stamp)
            if code and iso:
                self.by_code[str(code)] = iso
            for value in obj.values():
                self._walk(value, depth + 1)
        elif isinstance(obj, list):
            for value in obj:
                self._walk(value, depth + 1)


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


def parse_item_full(lines, author, likes_hint=None, now=None, dom_datetime=None,
                    network_ts=None, meta=None):
    """Bersihkan satu item -> (teks, timestamp, likes, sumber timestamp).

    Prioritas waktu: respons JSON (network) > <time datetime> > tanggal/jam di
    teks > waktu relatif ("2 j") yang ditandai estimated > tidak ada.
    """
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    keep, likes = [], likes_hint
    date_ts = rel_ts = None
    date_source = rel_source = None
    local_tz = datetime.now().astimezone().tzinfo

    for raw in lines or []:
        s = (raw or "").strip()
        if not s or s == author:
            continue
        mh = REPLY_HINT_RE.fullmatch(s)
        if mh:
            if meta is not None:
                meta["expected_replies"] = max(int(meta.get("expected_replies") or 0), int(mh.group(1)))
            continue
        md = DATE_RE.fullmatch(s)
        if md:
            if date_ts is None:
                date_ts = to_iso(*md.groups())
                date_source = "date"
            continue
        mt = DATETIME_RE.fullmatch(s)
        if mt:
            d, mo, y, hh, mm, ss, ampm = mt.groups()
            try:
                hour = int(hh) % 12 if ampm else int(hh)
                if ampm and ampm.upper() == "PM":
                    hour += 12
                dt = datetime(int(y), int(mo), int(d), hour, int(mm), int(ss or 0),
                              tzinfo=local_tz)
                if date_ts is None:
                    date_ts = dt.astimezone(timezone.utc).isoformat(timespec="seconds")
                    date_source = "dom"
            except ValueError:
                pass
            continue
        if JUST_NOW_RE.fullmatch(s):
            if rel_ts is None:
                rel_ts = now.isoformat(timespec="seconds")
                rel_source = "estimated"
            continue
        mr = REL_RE.fullmatch(s)
        if mr:
            if rel_ts is None:
                seconds = int(mr.group(1)) * REL_SECONDS.get(mr.group(2).lower(), 0)
                if seconds:
                    rel_ts = (now - timedelta(seconds=seconds)).isoformat(timespec="seconds")
                    rel_source = "estimated"
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

    ts, source = network_ts, "network" if network_ts else None
    if not ts:
        ts, source = normalize_dom_datetime(dom_datetime)
    if not ts and date_ts:
        ts, source = date_ts, date_source
    if not ts and rel_ts:
        ts, source = rel_ts, rel_source
    return "\n".join(keep), ts, likes, source or "missing"


def parse_item(lines, author, likes_hint=None):
    """Kompatibel dengan pemanggil lama: (teks, timestamp, likes)."""
    text, ts, likes, _ = parse_item_full(lines, author, likes_hint)
    return text, ts, likes


def clean(lines, author):
    """Kompatibel dengan pemanggil lama: hanya teks bersih."""
    return parse_item(lines, author)[0]


def normalize_post(p):
    """Pastikan schema baru ada walaupun data lama dibaca."""
    q = dict(p)
    q.setdefault("thread", [])
    q.setdefault("replies", [])
    q.setdefault("timestamp", None)
    q.setdefault("timestamp_source", None)
    q.setdefault("likes", None)
    q.setdefault("scraped_at", None)
    q.setdefault("first_scraped_at", q.get("scraped_at"))
    q.setdefault("last_scraped_at", q.get("scraped_at"))
    q.setdefault("scrape_count", 1 if q.get("scraped_at") else 0)
    q.setdefault("expected_replies", None)
    q.setdefault("truncated", False)
    q.setdefault("stop_reason", None)
    for key in ("replies", "thread"):
        for r in q.get(key, []):
            r.setdefault("timestamp", None)
            r.setdefault("timestamp_source", None)
            r.setdefault("likes", None)
            r.setdefault("parent_code", None)
            r.setdefault("root_code", None)
            r.setdefault("depth", 0 if key == "thread" else 1)
            r.setdefault("reply_to_author", None)
            r.setdefault("first_seen_at", q.get("scraped_at"))
            r.setdefault("last_seen_at", q.get("scraped_at"))
            r.setdefault("still_present", True)
    return q


def merge_items(old_items, new_items, now, complete):
    """Gabungkan komentar/thread per kode; item lama tidak hilang saat scrape parsial."""
    old_by_code = {x.get("code"): x for x in old_items if x.get("code")}
    merged = {}
    for item in new_items:
        code = item.get("code")
        if not code:
            continue
        old = merged.get(code) or old_by_code.get(code)
        cur = dict(old or {})
        for key, value in item.items():
            if value not in (None, "", [], {}) or key not in cur:
                cur[key] = value
        cur["first_seen_at"] = (old or {}).get("first_seen_at") or (old or {}).get("last_seen_at") or now
        cur["last_seen_at"] = now
        cur["still_present"] = True
        merged[code] = cur
    for old in old_items:
        code = old.get("code")
        if not code or code in merged:
            continue
        cur = dict(old)
        if complete:
            cur["still_present"] = False
        merged[code] = cur
    return list(merged.values())


def merge_post(old, new, now):
    """Gabungkan hasil scrape baru ke post lama tanpa membuang komentar yang tidak terlihat lagi."""
    old = normalize_post(old) if old else {}
    cur = dict(old)
    for key, value in new.items():
        if key in ("thread", "replies"):
            continue
        if value not in (None, "", [], {}) or key not in cur:
            cur[key] = value
    complete = bool(new.get("complete", not new.get("truncated")))
    cur["thread"] = merge_items(old.get("thread", []), new.get("thread", []), now, complete)
    cur["replies"] = merge_items(old.get("replies", []), new.get("replies", []), now, complete)
    cur["first_scraped_at"] = old.get("first_scraped_at") or old.get("scraped_at") or now
    cur["last_scraped_at"] = now
    cur["scraped_at"] = new.get("scraped_at") or now
    cur["scrape_count"] = int(old.get("scrape_count") or 0) + 1
    cur["timestamp_source"] = new.get("timestamp_source") or old.get("timestamp_source")
    cur["expected_replies"] = (new.get("expected_replies")
                               if new.get("expected_replies") is not None
                               else old.get("expected_replies"))
    cur["truncated"] = bool(new.get("truncated", False))
    cur["stop_reason"] = new.get("stop_reason") or old.get("stop_reason")
    return cur


def scroll_collect(page, rounds, store, stall=3, cap=None, meta=None, expand=None):
    """Scroll & kumpulkan item; berhenti lebih awal kalau tidak ada item baru.

    `meta` (opsional) diisi stop_reason/rounds untuk menandai kelengkapan data.
    `expand` (opsional) dipanggil tiap putaran untuk membuka balasan bersarang.
    """
    idle = 0
    reason = "rounds"
    used = 0
    for _ in range(rounds):
        used += 1
        if expand:
            try:
                expand()
            except Exception:
                pass
        before = len(store)
        for it in page.evaluate(JS_EXTRACT):
            old = store.get(it["code"])
            if old is None:
                store[it["code"]] = it
                continue
            # Item bisa pertama kali terbaca dalam keadaan terlipat; simpan versi terlengkap.
            if len(it.get("lines") or []) > len(old.get("lines") or []):
                old["lines"] = it["lines"]
            for key in ("likes", "parent", "dt"):
                if it.get(key) and not old.get(key):
                    old[key] = it[key]
        if cap and len(store) >= cap:
            reason = "cap"
            break
        idle = idle + 1 if len(store) == before else 0
        if idle >= stall:
            reason = "stall"
            break
        page.mouse.wheel(0, 2500)
        page.wait_for_timeout(random.randint(1000, 1800))
    if meta is not None:
        meta["stop_reason"] = reason
        meta["rounds"] = used
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


EXPAND_RE = re.compile(
    r"(?:lihat|tampilkan|view|show|more)\b.*\b(?:balasan|replies?|reply)\b|"
    r"\b\d+\s*(?:balasan|replies?|reply)\b", re.I)


def expand_replies(page, max_clicks=12):
    """Klik tombol 'Lihat N balasan' agar balasan bersarang ikut terbaca."""
    clicked = 0
    for _ in range(max_clicks):
        found = False
        try:
            loc = page.locator('[role="button"], button')
            total = min(loc.count(), 80)
        except Exception:
            return clicked
        for i in range(total):
            el = loc.nth(i)
            try:
                if not el.is_visible():
                    continue
                text = (el.inner_text() or "").strip()
                if not EXPAND_RE.search(text):
                    continue
                if el.get_attribute("data-sna-expanded"):
                    continue
                el.evaluate("e => e.setAttribute('data-sna-expanded', '1')")
                el.click(timeout=800)
                clicked += 1
                page.wait_for_timeout(random.randint(250, 500))
                found = True
                break
            except Exception:
                continue
        if not found:
            break
    return clicked


def build_reply_tree(main_code, main_author, replies):
    """Lengkapi depth/root_code/reply_to_author dari parent_code (best-effort)."""
    by_code = {r.get("code"): r for r in replies if r.get("code")}
    for item in replies:
        depth, root, seen = 0, main_code, set()
        cur = item
        while depth < 20 and cur:
            code = cur.get("code")
            if code in seen:
                break
            seen.add(code)
            parent = cur.get("parent_code")
            if not parent:
                break
            depth += 1
            if parent == main_code:
                root = main_code
                break
            parent_item = by_code.get(parent)
            if parent_item is None:
                root = parent
                break
            cur = parent_item
        item["depth"] = depth if depth > 0 else 1
        item["root_code"] = root
        parent_item = by_code.get(item.get("parent_code"))
        if item["depth"] <= 1:
            item["reply_to_author"] = main_author
        elif parent_item:
            item["reply_to_author"] = parent_item.get("author")
        else:
            item["reply_to_author"] = None
    return replies


def scrape_post(page, url, max_replies=400, collector=None):
    m = LINK_RE.search(url)
    if not m:
        raise ValueError(f"URL postingan tidak dikenali: {url}")
    code = m.group(2)
    page.goto(url, wait_until="domcontentloaded")
    page.wait_for_timeout(3000)
    expand_replies(page, max_clicks=30)
    store = {}
    meta = {}
    scroll_collect(page, max(8, math.ceil(max_replies / 40)), store, stall=3,
                   cap=max_replies + 1, meta=meta,
                   expand=lambda: expand_replies(page, max_clicks=8))
    main = store.get(code)
    if not main:
        return None                      # bisa berarti login kedaluwarsa / selector berubah

    now = datetime.now(timezone.utc)
    main_meta = {}
    main_text, main_ts, main_likes, main_src = parse_item_full(
        main["lines"], main["author"], main.get("likes"), now=now,
        dom_datetime=main.get("dt"),
        network_ts=(collector.by_code.get(code) if collector else None),
        meta=main_meta)
    thread, replies = [], []
    for c, v in store.items():
        if c == code:
            continue
        text, ts, likes, src = parse_item_full(
            v["lines"], v["author"], v.get("likes"), now=now,
            dom_datetime=v.get("dt"),
            network_ts=(collector.by_code.get(c) if collector else None))
        if not text:
            continue
        item = {"code": c, "author": v["author"], "text": text,
                "timestamp": ts, "timestamp_source": src, "likes": likes,
                "parent_code": v.get("parent")}
        if v["author"].lower() == main["author"].lower():
            item["depth"] = 0
            item["root_code"] = code
            item["reply_to_author"] = None
            thread.append(item)          # lanjutan thread, bukan komentar
        else:
            replies.append(item)
        if len(replies) >= max_replies:
            break

    build_reply_tree(code, main["author"], replies)
    expected = main_meta.get("expected_replies")
    truncated = len(replies) >= max_replies or (expected is not None and len(replies) < expected)
    stop_reason = "cap" if len(replies) >= max_replies else meta.get("stop_reason", "unknown")
    if expected is not None and len(replies) < expected and stop_reason != "cap":
        stop_reason = "incomplete"

    body = main_text
    if thread:
        body = (body + "\n\n" if body else "") + "\n".join(t["text"] for t in thread)
    if not main_src or main_src == "missing":
        if thread:
            main_src = thread[0].get("timestamp_source") or main_src
    return {"code": code, "url": url, "author": main["author"], "text": body,
            "timestamp": main_ts or (thread[0]["timestamp"] if thread else None),
            "timestamp_source": main_src,
            "likes": main_likes, "thread": thread, "replies": replies,
            "expected_replies": expected, "truncated": truncated,
            "stop_reason": stop_reason, "complete": not truncated,
            "scraped_at": now.isoformat(timespec="seconds")}


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


def save_json(path, data, backup=False):
    """Tulis JSON atomik. backup=True menyimpan versi lama ke <nama>.bak dulu."""
    if backup and os.path.exists(path):
        try:
            shutil.copy2(path, str(path) + ".bak")
        except OSError as e:
            log("! gagal membuat backup:", e)
    tmp = str(path) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def logged_in(ctx):
    """Cek cookie sesi Threads pada persistent context."""
    try:
        cookies = ctx.cookies()
    except Exception:
        return False
    return any(c.get("name") in SESSION_COOKIES and c.get("value")
               and "threads" in c.get("domain", "")
               for c in cookies)


def web_login(profile_dir, marker, progress_file, timeout):
    """Login interaktif untuk dipicu dari web: buka Chromium tampak, tunggu cookie sesi.

    Tidak memakai input() seperti mode `login` CLI. Selesai bila cookie sesi
    Threads muncul ATAU berkas marker dibuat tombol "Saya sudah login" di UI.
    """
    marker = str(marker) if marker else None
    if marker:
        try:
            os.remove(marker)
        except OSError:
            pass
    write_progress(progress_file, "login", message="Membuka browser login Threads…")
    ok, note = False, ""
    with sync_playwright() as p:
        try:
            ctx = p.chromium.launch_persistent_context(profile_dir, headless=False, locale="id-ID")
        except Exception as exc:                      # mis. tidak ada DISPLAY di server headless
            note = "Gagal membuka browser: %s" % exc
            log("!", note)
            write_progress(progress_file, "error", message=note, error=note)
            return 2
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            page.goto(BASE + "/login", wait_until="domcontentloaded")
        except Exception as exc:
            log("! gagal membuka halaman login:", exc)
        write_progress(progress_file, "login", message="Silakan login di jendela Chromium yang terbuka.")
        deadline = time.time() + max(30, int(timeout))
        while time.time() < deadline:
            try:
                if marker and os.path.exists(marker):
                    ok = True
                    note = "Login dikonfirmasi dari halaman web."
                    break
                if logged_in(ctx):
                    ok = True
                    note = "Sesi login terdeteksi."
                    break
            except Exception as exc:
                log("! pengecekan sesi gagal:", exc)
            page.wait_for_timeout(2000) if page else time.sleep(2)
        try:
            page.wait_for_timeout(1500)   # beri waktu cookie ditulis ke disk
        except Exception:
            pass
        ctx.close()
    if not ok:
        note = "Login tidak terdeteksi dalam batas waktu."
        log("!", note)
    write_progress(progress_file, "done" if ok else "error", message=note,
                   error="" if ok else note, success=ok)
    log(note)
    return 0 if ok else 2


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["login", "web-login", "profile", "keyword", "post"])
    ap.add_argument("target", nargs="?")
    ap.add_argument("--max-posts", type=int, default=10)
    ap.add_argument("--max-replies", type=int, default=400, help="batas komentar per postingan")
    ap.add_argument("--out", default=OUT, help="file hasil (default: data.json)")
    ap.add_argument("--delay", type=float, default=3.0, help="jeda dasar antar postingan (detik)")
    ap.add_argument("--profile-dir", default=PROFILE_DIR, help="direktori sesi login")
    ap.add_argument("--show", action="store_true", help="tampilkan browser")
    ap.add_argument("--web", action="store_true", help="dipicu server web: log ke stderr + progres")
    ap.add_argument("--progress-file", default="", help="tulis status job ke JSON ini")
    ap.add_argument("--replace", action="store_true", help="timpa data lama (default: digabung)")
    ap.add_argument("--login-timeout", type=int, default=300, help="batas tunggu login web (detik)")
    ap.add_argument("--login-marker", default="", help="berkas penanda konfirmasi login dari web")
    a = ap.parse_args()
    say = log if a.web else print
    prog = a.progress_file if a.web else ""

    if a.mode == "web-login":
        return web_login(a.profile_dir, a.login_marker, prog, a.login_timeout)

    if a.mode in ("profile", "keyword", "post") and not a.target:
        say("! target belum diisi")
        write_progress(prog, "error", message="Target belum diisi.")
        return 2

    with sync_playwright() as p:
        try:
            ctx = p.chromium.launch_persistent_context(
                a.profile_dir, headless=not (a.show or a.mode == "login"), locale="id-ID")
        except Exception as exc:
            say("! gagal membuka browser:", exc)
            write_progress(prog, "error", message="Gagal membuka browser: %s" % exc,
                           error=str(exc))
            return 2
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        collector = TimestampCollector()
        collector.attach(page)

        if a.mode == "login":
            page.goto(f"{BASE}/login")
            input("Login dulu di browser, lalu tekan Enter di sini... ")
            ctx.close()
            return

        write_progress(prog, "discover", message="Mencari postingan…")
        if a.mode == "profile":
            urls = get_profile_posts(page, a.target.lstrip("@"), a.max_posts)
        elif a.mode == "keyword":
            urls = get_keyword_posts(page, a.target, a.max_posts)
        else:
            urls = [a.target]
        say(f"{len(urls)} postingan akan diambil")
        if not urls:
            ctx.close()
            note = "Tidak ada postingan ditemukan. Periksa target atau sesi login."
            say("!", note)
            write_progress(prog, "error", message=note, error=note)
            return 1

        new_results, failed = [], []
        write_progress(prog, "scrape", done=0, total=len(urls),
                       message=f"Mengambil 0 dari {len(urls)} postingan…")
        for i, u in enumerate(urls, 1):
            r = None
            for attempt in range(1, 3):
                try:
                    r = scrape_post(page, u, a.max_replies, collector)
                    if r:
                        break
                except Exception as e:                       # noqa: BLE001 - lanjut ke retry
                    say(f"  ! percobaan {attempt} gagal: {e}")
                time.sleep(1.5 * attempt)
            if r:
                new_results.append(r)
                say(f"[{i}/{len(urls)}] @{r['author']}: "
                    f"{len(r['replies'])} komentar · {len(r['thread'])} thread"
                    f"{' · terpotong' if r.get('truncated') else ''}")
            else:
                failed.append({"url": u, "time": iso_now()})
                say(f"[{i}/{len(urls)}] ! gagal: {u}")
            write_progress(prog, "scrape", done=i, total=len(urls),
                           message=f"Mengambil {i} dari {len(urls)} postingan…",
                           saved=len(new_results), failed=len(failed))
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
            say("URL gagal dicatat ke", FAILED)
        if new_results or not failed:
            posts = {} if a.replace else load_posts(a.out)
            for r in new_results:
                if a.replace:
                    posts[r["code"]] = r
                else:
                    now = r.get("scraped_at") or iso_now()
                    posts[r["code"]] = merge_post(posts.get(r["code"]), r, now)
            save_json(a.out, {
                "schema_version": 2,
                "generated_at": iso_now(),
                "posts": list(posts.values()),
            }, backup=True)
            say("Tersimpan ke", a.out)
            write_progress(prog, "done", done=len(urls), total=len(urls),
                           saved=len(new_results),
                           message=f"Selesai · {len(new_results)} postingan baru · {len(posts)} total di data.json")
        else:
            note = ("Tidak ada hasil baru; file hasil tidak ditimpa. "
                    "Jika semua gagal, sesi login bisa kedaluwarsa — klik Login di halaman web.")
            say(note)
            write_progress(prog, "error", done=len(urls), total=len(urls), saved=0,
                           message=note, error=note)
            ctx.close()
            return 1
        ctx.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
