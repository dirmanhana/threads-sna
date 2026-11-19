# Daftar kerja — Threads SNA

Checklist dari saran yang disetujui. Selesai semua pada sesi ini.

## P0 — Kualitas data (biar graf tidak bias)
- [x] Pisahkan `thread` (lanjutan penulis) dari `replies`; gabungkan teks thread ke `post.text`
- [x] Bersihkan metadata dari teks: tanggal `dd/mm/yyyy`, `rb tayangan`, jumlah suka
- [x] Tambah field opsional `timestamp`, `likes`, `parent_code`, `scraped_at` (backward compatible)
- [x] Migrasi `data.json` lama ke schema baru (backup → `data.json.bak`)

## P1 — Analitik SNA
- [x] Centrality: degree, betweenness, closeness, eigenvector + tampilkan peringkat di panel
- [x] Deteksi komunitas (Louvain) + warna node per komunitas (toggle)
- [x] Filter: toggle jenis edge (komentar / mention / co-comment), slider derajat minimum, filter tanggal
- [x] Edge type baru: `co-comment` (dua akun komentar di postingan sama)
- [x] Ekspor CSV node, CSV edge, GraphML, PNG, SVG

## P2 — Viewer / UX
- [x] Tombol Reset zoom (yang lama hanya mereset panel)
- [x] Tooltip hover + fokus/isolasi ego-network + dropdown loncat ke akun
- [x] Banner error saat `fetch("data.json")` gagal (jangan diam-diam pakai sample)
- [x] Ringkasan di header: jumlah post / komentar / thread / akun / relasi

## P3 — Scraper & engineering
- [x] Berhenti scroll saat tidak ada item baru + opsi `--max-replies`
- [x] Retry gagal, catat URL gagal ke `failed.json`, deteksi sesi login kedaluwarsa
- [x] Opsi `--out` dan jeda yang bisa diatur (`--delay`)
- [x] Unit test untuk `clean()`/`parse_item()` (8 test Python) dan logika graf (12 test Node)
- [x] Perbarui README (schema, flags, fitur) + `.gitignore`

## Fitur tambahan (permintaan lanjutan)
- [x] Nama user di tabel/daftar/kartu/detail link diklik → buka postingan asli di Threads (tab baru). Fallback ke postingan partisipasi bagi commenter.
- [x] Ekspor PNG/SVG full-graph: hitung bbox semua node + label, lepas transform zoom, tidak terpotong pada kondisi default/reset zoom.
- [x] Mode layar penuh: hanya peta jaringan; tombol **Layar penuh**, keluar via tombol mengambang atau `Esc`.

## Fitur utilitas & pelaporan
- [x] Time-lapse / network replay: tombol **▶ Putar / ⏸ Jeda**, slider scrub, kecepatan 1×/5×/20×, panel peristiwa terbaru, dan **Kembali ke akhir**. Event dibangun dari post + thread + replies (903 peristiwa pada data nyata); timestamp kosong diberi waktu sintetis dari tanggal terdekat. Metrik dihitung sekali dari graf penuh supaya warna komunitas stabil saat replay.
- [x] Snapshot & report export: **PNG/SVG laporan** — satu gambar berisi graf penuh + ringkasan statistik (postingan, komentar, thread, akun, relasi, komunitas, 5 aktor teratas) + legenda edge/node. PNG laporan ~6000 px (teruji 6000×5509).
- [x] Fix scrub: baca nilai slider sebelum `stopReplay()` menimpa `slider.value` dengan posisi lama (scrub 60 kini benar-benar loncat ke 60/903).

## Deteksi anomali & perilaku akun (anti-buzzer/bot)
- [x] Fungsi murni di `viewer_core.js`: `normText`, `textTokens`, `tokenKey`, `detectCIB`, `temporalBuckets`, `bucketEvents`, `buzzerScores`
- [x] CIB: normalisasi teks + Jaccard ≥0,8, jendela 5/10/30 mnt, minimal 2/3/5 akun, confidence lebih rendah untuk timestamp bertanggal saja
- [x] Timeline batang interaktif (menit/jam/hari/otomatis) + deteksi lonjakan robust (median/MAD leave-one-out) + detail bucket
- [x] Skor buzzer 0–100 + alasan, sorotan ring merah/kuning di graf, panel 🚨 Anomali, ringkasan ikut ke ekspor laporan
- [x] 9 test Node baru (total 22) untuk normalisasi, CIB (waktu/mirip/renggang/tanggal), bucket+burst, dan skor buzzer
- [x] Verifikasi browser: data nyata 170 komentar bertimestamp → 4 lonjakan; data sintetis 3 bot → 1 klaster CIB, skor 72 (tinggi), 3 cincin risiko, klik fokus & bucket bekerja, tanpa page error

## Analisis konten & NLP via LLM
- [x] `.env` + `.env.example` untuk kredensial LLM (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL=cmd`, batch/timeout/max tokens); `.env` & `llm_analysis.json` gitignored
- [x] Skrip batch `llm_analyze.py`: topik + keyword sekali, lalu label sentimen/emotion/toxicity/spam/topic per batch, retry + penulisan atomik
- [x] `content_key` FNV-1a 64-bit identik di Python dan `SNA.contentKey` (browser) + paritas di test Python/Node
- [x] Halaman mandiri `sentimen.html` (tidak dicampur ke viewer): label sentimen per komentar, emosi/topik/toksisitas/spam, filter + pencarian, pengurutan, ekspor CSV, ringkasan & kata kunci; viewer dikembalikan ke versi tanpa LLM
- [x] Analisis bisa dipicu langsung dari halaman: `llm_server.py` (dipakai `./run.sh serve`) menyediakan `/api/analyze` + `/api/status`, menjalankan skrip di lokal dengan progres, kunci tetap di `.env` dan diblokir dari fetch statis
- [x] Token LLM tidak dikirim ke browser; viewer dan halaman sentimen tetap jalan tanpa `llm_analysis.json` (dengan petunjuk)
- [x] Test: 8 test Python baru (env/key/collect/parse/request) + 1 test Node (paritas kunci) → total 16 Python + 23 Node
- [x] Verifikasi browser dengan hasil LLM sintetis: label per baris, filter, ekspor CSV, tanpa page error

## Perbaikan lanjutan
- [x] Bug: akun yang hanya disebut (@mention) tidak punya node → `d3.forceLink` melempar `node not found`, yang salah dilaporkan sebagai "Gagal memuat data.json" / "JSON tidak valid"

## Port tampilan ke React + Tailwind (Mosaic Lite)
- [x] Scaffold Vite + React 19 + Tailwind CSS v4 (`package.json`, `vite.config.mjs`, `index.html`, `src/`); build ke `dist/`
- [x] Layout dashboard: sidebar (collapse + mode gelap), header, kartu KPI, footer atribusi Mosaic Lite
- [x] Port penuh `sentimen.html` → `SentimentPage.jsx`: label per komentar, filter, ringkasan, topik, kata kunci, ekspor CSV, tombol analisis + progres
- [x] Port penuh `viewer.html` → `ViewerPage.jsx` + komponen `GraphCanvas`, `Timeline`, `InfoPanel`
- [x] Fitur viewer tetap lengkap: filter edge/derajat/tanggal/akun/pencarian, fokus & isolasi, fullscreen, time-lapse + scrub, anomali/CIB/buzzer, timeline klik, ekspor CSV/GraphML/PNG/SVG/laporan
- [x] `viewer_core.js` tetap dipakai (UMD sekaligus menetapkan `globalThis.SNA` untuk bundler ESM); 16 test Python + 23 test Node tetap lulus
- [x] `llm_server.py` menyajikan `dist/` dan memetakan `/viewer.html` + `/sentimen.html` ke SPA; fallback ke HTML lama sebelum build; `.env` tetap diblokir
- [x] `run.sh build`, auto-build saat `serve` pertama, `.gitignore` untuk `node_modules/` & `dist/`, `LICENSE` GPL-3.0 + atribusi Mosaic Lite
- [x] Verifikasi browser (Playwright) kedua halaman dengan data nyata: 790 node/854 relasi, 819 komentar berlabel, tanpa page error; filter, fokus/isolasi, anomali, replay, ekspor, dark mode berfungsi
- [x] `install.sh` diperbarui menjadi installer end-to-end (7 tahap): prasyarat Python/Node 20+/npm, venv + requirements, Chromium (+ `WITH_DEPS`), dependensi npm, build `dist/`, template `.env` tanpa menimpa, dan verifikasi test; opsi `SKIP_BROWSER`/`SKIP_BUILD`/`SKIP_TESTS`
- [x] Pisahkan error parse JSON vs error render di banner viewer; beri petunjuk `./run.sh serve` kalau `fetch` diblokir
- [x] Tambah test regresi mention-only node (13 test Node)

## Verifikasi
- `./run.sh test` → 8 test Python + 22 test Node lulus
- Uji browser headless: data.json termuat via HTTP **dan** via input file; `file://` menampilkan petunjuk serve; JSON rusak tetap terdeteksi; toggle co-comment tanpa page error
- `SNA.build(data.posts)` → 665 akun · 753 relasi · 20 komunitas (default)
- Filter tanggal & toggle co-comment sudah diuji terhadap data nyata
- Uji browser headless time-lapse: play/jeda stabil, scrub 60 → 60/903, kembali ke akhir → 903/903 tanpa page error
- Uji browser headless laporan: SVG mengandung judul/legenda/statistik/aktor teratas; PNG laporan 6000 px tanpa page error

## Catatan
- `parent_code` diisi best-effort dari quote-reply; balasan bersarang belum sepenuhnya dibedakan.
- Data lama yang belum punya `timestamp` tidak ikut tersaring saat filter tanggal aktif.
