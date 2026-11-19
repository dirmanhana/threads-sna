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

## Pengumpulan data dari web (tanpa terminal)
- [x] `llm_server.py` menyediakan `/api/scrape/{start,status,cancel}` + `/api/login/{start,status,confirm,cancel}`; job background dengan progres, log, dan perlindungan proses ganda
- [x] `scrape_threads.py` mode `web-login` (Chromium tampak, deteksi cookie `sessionid`/`ds_user_id`, fallback marker) tanpa `input()`, plus `--web`, `--progress-file`, `--replace`
- [x] Tulis `data.json` atomik + backup otomatis `data.json.bak` saat opsi "timpa" dipilih
- [x] Halaman baru `ScrapePage.jsx` + rute `/scrape.html` + item sidebar "Pengumpulan Data": login, form profil/kata kunci/URL, gabung/timpa, progres, log, ringkasan data, unduh
- [x] File progres/marker gitignored dan diblokir dari akses statis; server tetap terikat ke `127.0.0.1`
- [x] 10 test Python baru (validasi input, progres atomik, backup, endpoint dengan scraper stub); verifikasi Playwright alur form → progres → data 1 postingan tanpa page error

## Tata letak Mosaic (tahap 1–2)
- [x] Shell baru: sidebar bergrup (Utama/Analisis/Data) 80 px ↔ 256 px, header 64 px dengan pencarian global + status data + toggle tema
- [x] Judul halaman dipindah ke area konten lewat `PageHeader` (30 px bold) dengan baris aksi di kanan
- [x] Komponen kartu: `Card`/`CardHeader`/`CardBody`, `KpiCard`, `StatusPill`, `EmptyState`, `MiniCharts` (bar + donut SVG, tanpa Chart.js)
- [x] Token `.card`/`.kpi` diseragamkan ke `rounded-xl`; body memakai `slate-100`; kontras teks sekunder dinaikkan
- [x] Halaman **Ringkasan** di `/` (juga `/index.html`, `/ringkasan.html`): KPI, volume komentar, donut sentimen, tabel aktor, aktivitas, sinyal risiko, topik LLM
- [x] Pencarian global → `/viewer.html?focus=<akun>`; `ViewerPage` membaca parameter dan memfokuskan akun setelah data termuat
- [x] `llm_server.py` memetakan `/`, `/index.html`, `/ringkasan.html` ke build React

## Tata letak Mosaic (tahap 3)
- [x] Viewer grid 8/4 pada ≥1280 px: graf `col-span-8`, panel informasi `col-span-4`; ponsel satu kolom dengan graf 420–520 px
- [x] Panel info bertab **Metrik | Postingan | Komentar | Anomali**, badge jumlah anomali, dan pencarian di dalam tab
- [x] Pagination: 10 postingan/halaman, 20 komentar/halaman; diskusi postingan dilipat dan dimuat 20 komentar per klik
- [x] Panel memakai scroll internal (`overflow-y-auto`) dengan tinggi terbatas, bukan halaman yang memanjang
- [x] Graf D3 auto-fit ke viewport setelah simulasi dan saat kontainer berubah (mis. layar penuh); label disembunyikan saat zoom rendah
- [x] Komponen `PostCard`/tab dipindah ke level modul agar state pagination dan lipatan tidak hilang saat parent re-render
- [x] Verifikasi Playwright desktop 1440 px + ponsel 390 px: 32 pemeriksaan lulus (tab, pagination, lipat diskusi, pencarian, `?focus=`, bucket, replay, layar penuh, tanpa overflow/page error)

## Scraping lanjutan (paket 1, 2, 4, 5)
- [x] **Timestamp absolut**: `TimestampCollector` membaca `taken_at`/`created_at` dari respons JSON internal; fallback `<time datetime>`, tanggal/jam DOM, lalu waktu relatif bertanda `estimated`. Sumber disimpan di `timestamp_source` dan “(perkiraan)” ditampilkan di panel.
- [x] **Gabung per komentar**: `merge_items`/`merge_post` mempertahankan komentar lama, memperbarui yang masih ada, dan menambah yang baru. `first_seen_at` stabil, `last_seen_at` diperbarui, `still_present` hanya `false` bila scrape baru lengkap.
- [x] **Pohon balasan**: `build_reply_tree` mengisi `parent_code`, `depth`, `root_code`, `reply_to_author`; viewer mengurutkan akar → anak → cucu, memberi indentasi, dan label “balasan ↳ @akun”.
- [x] **Keamanan API lokal**: `GET /api/session` memberi token acak per proses; semua `POST` wajib `X-SNA-Token`; `Host` non-loopback dan `Origin` lintas situs ditolak. Klien `api()` mengambil token otomatis dan retry sekali saat 401.
- [x] `expected_replies`, `truncated`, `stop_reason`, dan `complete` menandai kelengkapan hasil scrape.
- [x] Test baru: timestamp (network/DOM/estimasi), merge parsial vs lengkap, pohon balasan, token 401, dan origin 403.

## Verifikasi
- `./run.sh test` → 41 test Python + 23 test Node lulus (termasuk 14 test API scraping dengan stub dan 5 test penyimpanan proyek)
- Playwright proyek per proyek (15 pemeriksaan lulus): Ringkasan memuat `/projects/default/data.json`, pemilih proyek di header, sidebar mempertahankan `?project=`, tampilan 11 post, kartu "0 · Proyek" di Pengumpulan Data, buat proyek lewat browser → buka lewat URL → hapus proyek
- Playwright: `/`, `/ringkasan.html`, `/index.html`, `/viewer.html`, `/sentimen.html`, `/scrape.html` tanpa page error; desktop 1440 px dan ponsel 390 px tanpa overflow horizontal
- Playwright viewer data nyata: 32 pemeriksaan lulus (tab, pagination, lipat diskusi, pencarian, `?focus=`, bucket, replay, layar penuh)
- Playwright fixture pohon balasan: urutan akar → anak → cucu, indentasi 12/24 px, label tujuan balasan, dan “(perkiraan)” tampil; 9 pemeriksaan lulus
- Playwright token: POST dari browser mengirim `X-SNA-Token` yang cocok; tanpa token 401; origin asing 403
- Pencarian global “anabel” → klik hasil → `/viewer.html?focus=anabelpolitik` dan panel akun langsung terbuka
- Tema gelap/terang, sidebar 80 ↔ 256 px, dan donut/bar chart terverifikasi lewat DOM
- Audit kontras halaman Ringkasan: 0 teks di bawah ambang WCAG AA pada mode terang
- Uji browser headless: data.json termuat via HTTP **dan** via input file; `file://` menampilkan petunjuk serve; JSON rusak tetap terdeteksi; toggle co-comment tanpa page error
- `SNA.build(data.posts)` → 665 akun · 753 relasi · 20 komunitas (default)
- Filter tanggal & toggle co-comment sudah diuji terhadap data nyata
- Uji browser headless time-lapse: play/jeda stabil, scrub 60 → 60/903, kembali ke akhir → 903/903 tanpa page error
- Uji browser headless laporan: SVG mengandung judul/legenda/statistik/aktor teratas; PNG laporan 6000 px tanpa page error

## Data per proyek (selesai)
- [x] Modul terpusat `projects.py`: slug `[a-z0-9-]` (maks 41, selalu mulai alnum), `project_dir` menolak path traversal, penulisan atomik, `index.json`, dan daftar proyek dibaca dari isi folder `projects/<slug>/`.
- [x] Satu proyek = `projects/<slug>/{meta.json, data.json, llm_analysis.json, failed.json, scrape_progress.json, llm_progress.json}`; `.trash/` untuk proyek dihapus (bisa dipulihkan manual).
- [x] Migrasi otomatis: server pertama kali membuat proyek `default` dari `data.json`/`llm_analysis.json`/`failed.json` lama dengan **menyalin** (file lama tetap aman).
- [x] Server: `?project=<slug>` untuk GET status/scrape/data; `project` di body untuk POST analyze/scrape/start dan CRUD `/api/projects{,/rename,/delete}`; slug tidak valid → 400; proyek tidak ada → 404; berkas proyek hanya `data.json` & `llm_analysis.json` yang disajikan (whitelist ketat, anti path traversal).
- [x] Scraper & LLM menerima `--project`; `./run.sh analyze` default proyek `default` (`PROJECT=nama ./run.sh analyze`); halaman React (`Layout`, `GlobalSearch`, Ringkasan, Peta, Sentimen, Pengumpulan Data) memuat proyek aktif via `?project=` + `localStorage`, dengan pemilih proyek di header dan kartu "0 · Proyek" di halaman Pengumpulan Data.
- [x] Tes: `tests/test_projects.py` (5 test) + `tests/test_scrape_api.py` dialihkan ke direktori proyek sementara; 41 test Python + 23 test Node lulus; Playwright 15 pemeriksaan (Ringkasan/Peta/Sentimen/Pengumpulan Data, buat→buka→hapus proyek lewat browser) lulus.
- [x] Penyimpanan tetap JSON (bukan SQLite) — data masih kecil; `projects.py` menjadi satu-satunya lapisan bila nanti perlu pindah.

## Restrukturisasi UI gaya NusaPulse (selesai)
- [x] Shell SPA bertab tunggal (Ringkasan / Peta Jaringan / Sentimen / Sumber & Proyek) ala NusaPulse: palet slate/biru, font Plus Jakarta Sans/DM Sans/JetBrains Mono, sidebar 248 px dengan proyek dropdown & nav 4 tab, header breadcrumb + pencarian + aksi **Analisis AI**, konten `max-w-[1440px]` (`src/App.jsx`, `src/components/Layout.jsx`, `index.html`, `src/index.css`).
- [x] Ringkasan: KPI, tren volume, proporsi sentimen, aktor utama, topik dominan, deteksi CIB, dan panel **Ringkasan AI** (narasi ringkas sisi klien dari statistik; label per komentar tetap lewat `/api/analyze`).
- [x] Peta Jaringan: toolbar/filter, graf D3, rail info bertab, timeline & replay, ekspor, dan fokus akun dipertahankan; kompatibel dengan deep-link `/viewer.html?focus=<akun>` (membuka tab Peta Jaringan dan fokus akun).
- [x] Sentimen: KPI, feed berfilter + CSV, sidebar proporsi/topik/kata kunci/info dataset.
- [x] Sumber & Proyek: ingesti & progres, manajemen proyek, dan **Impor & Cadangkan Dataset JSON** (unduh `data.json`/`llm_analysis.json` per proyek). Impor tulis ke server tidak ditambahkan (muat lokal via Peta Jaringan / salin ke `projects/<slug>/` saat server mati). Fitur Live Stream/simulasi dan "Uji Klasifikasi" tidak disertakan.
- [x] Komponen pendukung (`Card`, `KpiCard`, `StatusPill`, `EmptyState`, `MiniCharts`, `InfoPanel`, `Timeline`, `GlobalSearch`, `GraphCanvas`, dll.) diadaptasi ke gaya baru; backend (`llm_server.py`, `projects.py`, `viewer_core.js`) tidak diubah. Atribusi Mosaic Lite (GPL-3.0) dipertahankan; pola NusaPulse dire-implementasi (tanpa salin kode, template tanpa lisensi).
- [x] `npm run build` OK; 41 test Python + 23 test Node lulus; verifikasi Playwright (4 tab + deep-link `/viewer.html?focus=0jenry1&project=default`) lulus tanpa page error console.

## Roadmap perbaikan berikutnya

Diurutkan berdasarkan prioritas. Nomor mengikuti paket saran scraping sebelumnya (1, 2, 4, 5 sudah selesai).

### 3 · Checkpoint & pembatalan scraping — berikutnya
- [ ] Simpan checkpoint per postingan ke `scrape_progress.json`: URL yang sudah selesai, antrean tersisa, dan waktu terakhir.
- [ ] `POST /api/scrape/start` mendeteksi checkpoint dan menawarkan **lanjutkan** atau **mulai ulang**.
- [ ] `POST /api/scrape/cancel` menghentikan scroll/retry dalam ≤5 detik dan menulis hasil parsial dengan aman.
- [ ] Tombol **Batalkan** yang jelas di halaman Pengumpulan Data + status “dibatalkan sebagian”.
- [ ] Job yang dibatalkan **tidak boleh** menandai `still_present: false` karena hasilnya parsial.
- [ ] Tes: resume tidak mengulang postingan selesai; cancel tidak menimpa data lama; proses anak benar-benar berhenti.

### Backlog (belum dijadwalkan)
- [ ] Antrean URL persisten + retry terjadwal untuk `failed.json`.
- [ ] Deteksi perubahan struktur DOM/JSON Threads dan peringatan selector di halaman Pengumpulan Data.
- [ ] Ekspor/impor dataset dengan versi schema + migrasi otomatis saat schema berubah.
- [ ] Penjadwalan scraping berkala (cron lokal) dengan batas laju dan jeda acak.
- [ ] Audit aksesibilitas lanjutan: fokus keyboard, `aria-live` untuk progres, dan kontras mode gelap.
- [ ] Uji beban data besar (≥10 ribu komentar) untuk viewer, analitik, dan panel bertab.

## Catatan
- `parent_code` diisi best-effort dari struktur DOM/quote-reply; balasan yang tidak pernah dirender (mis. tersembunyi di balik “Lihat balasan” yang gagal diklik) tetap tidak terbaca.
- Data lama yang belum punya `timestamp` tidak ikut tersaring saat filter tanggal aktif.
- Token API adalah pengaman tambahan untuk API lokal, bukan pengganti bind `127.0.0.1`.
