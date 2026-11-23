# Threads SNA

Ambil postingan dan komentar dari Threads dengan Playwright, lalu lihat jaringannya: siapa posting apa, siapa mengomentari, siapa menyebut siapa. Semua proses berjalan lokal; pengumpulan data bisa dipicu lewat terminal **atau langsung dari browser**.

## Instalasi

```bash
chmod +x install.sh && ./install.sh
```

Satu perintah ini menyiapkan **semua tahapan**:

1. Cek prasyarat: Python 3, **Node.js 20+**, dan npm.
2. Buat `.venv` lalu install paket dari `requirements.txt` (Playwright).
3. **Tanya apakah ingin memasang IndoBERT** (engine sentimen lokal, opsional).
4. Install browser Chromium untuk Playwright.
5. Install dependensi Node (`npm ci` bila `package-lock.json` ada, sebaliknya `npm install`).
6. Build dashboard React + Tailwind ke `dist/` (`npm run build`).
7. Buat `.env` dari `.env.example` bila belum ada (tidak pernah menimpa kredensial yang sudah diisi).
8. Verifikasi dengan unit test Python + Node.

Opsi environment: `WITH_DEPS=1` (library sistem Chromium, butuh sudo di Linux), `SKIP_BROWSER=1`, `SKIP_BUILD=1`, `SKIP_TESTS=1`, dan `PYTHON=python3.12` untuk memilih interpreter.

### Pilihan IndoBERT saat instalasi

Di langkah 3, `install.sh` menanyakan apakah Anda ingin memasang engine sentimen lokal:

```
==> [3/8] Engine sentimen lokal IndoBERT (opsional)
    IndoBERT melabeli sentimen sepenuhnya offline (tanpa API LLM),
    tapi hanya 3 kelas: positif/negatif/netral. ...
    Ukuran unduhan: ~2,5 GB (torch) + ~500 MB (bobot model).
    Pasang IndoBERT sekarang? [y/N]
```

Jawaban kosong berarti **tidak** (default aman, karena unduhannya besar). Bila dipilih `y`, skrip akan:

1. Mendeteksi GPU lewat `nvidia-smi` dan memilih index wheel CUDA yang cocok dengan driver (mis. CUDA 13.4 → `cu130`, CUDA 12.4 → `cu124`). Tanpa GPU, dipakai build CPU.
2. Memasang `torch` dari index yang sesuai, lalu `transformers` dan `sentencepiece`.
3. Memverifikasi bahwa torch benar-benar melihat GPU, dan memberi peringatan bila tidak.
4. Menulis `SENTIMENT_ENGINE=indobert` dan `INDOBERT_DEVICE=<cuda|cpu>` ke `.env` tanpa mengubah kunci lain.

Instalasi non-interaktif (CI, `curl | bash`) otomatis melewati langkah ini. Untuk mengatur tanpa tanya:

```bash
WITH_INDOBERT=1 ./install.sh                 # pasang, deteksi device otomatis
WITH_INDOBERT=0 ./install.sh                 # lewati
WITH_INDOBERT=1 INDOBERT_DEVICE=cpu ./install.sh      # paksa CPU
WITH_INDOBERT=1 TORCH_CUDA_INDEX=cu128 ./install.sh   # paksa index CUDA
```

Memilih `n` tidak mengunci apa pun: perintah pemasangan manualnya dicetak di akhir, dan bisa dijalankan kapan saja.

Kalau ingin install manual per bagian: `python -m venv .venv && pip install -r requirements.txt && playwright install chromium`, lalu `npm install && npm run build`. `./run.sh serve` juga otomatis build bila `dist/` belum ada.

Untuk fitur analisis konten berbasis LLM, salin `.env.example` menjadi `.env` lalu isi kredensial. File `.env` **tidak pernah dikirim ke browser** dan sudah masuk `.gitignore`. Skrip analisis memakai `urllib` standar Python (tanpa dependency tambahan).

## Pemakaian

```bash
./run.sh login                              # sekali saja, login manual di browser yang terbuka
./run.sh keyword "umkm" 15 400              # cari kata kunci, 15 postingan, maks 400 komentar/post
./run.sh profile akun_target 10             # atau ambil dari satu profil
./run.sh post https://www.threads.com/@akun/post/XXXX
./run.sh build                              # build tampilan React + Tailwind ke dist/
./run.sh serve                              # buka http://localhost:8000/ (Ringkasan)
                                            # peta: http://localhost:8000/viewer.html
                                            # sentimen: http://localhost:8000/sentimen.html
                                            # data: http://localhost:8000/scrape.html
./run.sh migrate                            # migrasi data.json lama ke schema baru (satu file; --src bisa menunjuk projects/<slug>/data.json)
./run.sh analyze                            # analisis proyek `default` (variabel PROJECT=nama untuk proyek lain)
./run.sh analyze --limit 100 --dry-run      # cek rencana tanpa panggil API
./run.sh test                               # unit test (Python + Node)
```

Opsi lanjutan lewat `scrape_threads.py` langsung: `--out`, `--delay` (jeda dasar antar postingan, detik), `--max-replies`, `--profile-dir`, `--show`. Lewat `run.sh` bisa diatur dengan env: `OUT=nama.json DELAY=5 PROFILE_DIR=./akun_lain ./run.sh keyword "umkm"`.

Browser memakai **Google Chrome asli** bila terpasang (`THREADS_BROWSER_CHANNEL=chrome`, default) agar fingerprint login lebih normal, lalu otomatis fallback ke Chromium bawaan Playwright. Set `THREADS_BROWSER_CHANNEL=none` untuk selalu memakai Chromium.

Hasil disimpan ke `projects/default/data.json` (per proyek) dan **digabung** dengan data lama (berdasarkan kode postingan). Saat opsi gabung aktif, komentar yang sudah ada tidak dibuang walaupun tidak terlihat lagi pada scrape baru; item seperti itu hanya ditandai `still_present: false` bila scrape baru benar-benar lengkap. URL yang gagal dicatat ke `failed.json`. Jika semua postingan gagal dibaca, file hasil tidak ditimpa dan akan muncul peringatan kemungkinan sesi login kedaluwarsa.

### Pengumpulan data dari browser (tanpa terminal)

Jalankan `./run.sh serve` sekali, lalu buka **`http://localhost:8000/scrape.html`**. Halaman "Pengumpulan Data" di sidebar menyediakan alur lengkap:

1. **Login** — tombol "Buka browser login" menyuruh server lokal membuka Chrome/Chromium tampak. Login manual di jendela itu; deteksi cookie `.threads.com` berjalan otomatis. Tombol "Saya sudah login" hanya fallback. Sesi tersimpan per profil di `threads_profiles/<id>/profile/` (gitignored, cookie/sesi sensitif) dan **tidak pernah dikirim ke browser**. Anda bisa membuat beberapa profil, memilih profil aktif, login, logout, atau menghapus profil dari kartu Sesi Threads.
2. **Ambil data** — pilih proyek (atau buat baru di kartu "0 · Proyek"), lalu pilih profil / kata kunci / URL postingan, jumlah postingan, batas komentar, dan opsi **gabungkan atau timpa** data lama. Opsi timpa tetap membuat backup `data.json.bak` di folder proyek sebelum menulis.
3. **Pantau progres** — jumlah postingan yang selesai, pesan, dan log ditampilkan langsung. Job berjalan di server, jadi halaman boleh ditutup dan dibuka lagi.
4. **Pakai hasilnya** — tombol "Buka di peta jaringan" memuat `projects/<slug>/data.json` yang baru.

Catatan: scraper tetap memakai Playwright sungguhan, jadi **login pertama memerlukan desktop dengan tampilan browser**. Di server headless murni, lakukan `./run.sh login` sekali lewat terminal. Endpoint hanya di-bind ke `127.0.0.1` — jangan diubah ke `0.0.0.0` karena itu akan memungkinkan pihak lain memicu browser dengan sesi Anda.

API yang dipakai halaman ini: `GET /api/scrape/status`, `POST /api/scrape/start`, `/api/scrape/cancel`, `GET /api/login/status`, `POST /api/login/start`, `/api/login/confirm`, `/api/login/cancel`, `GET /api/projects`, `POST /api/projects`, `/api/projects/rename`, `/api/projects/delete`. `scrape_progress.json`, `login_progress.json`, dan `login_selesai.marker` adalah file sementara (gitignored) dan diblokir dari akses statis. Semua endpoint penerima parameter `?project=<slug>` (atau field `project` di body) berjalan untuk proyek yang dipilih; proyek `default` dipakai bila tidak disebutkan.

**Keamanan API lokal:** semua `POST` wajib membawa header `X-SNA-Token` yang diberikan `GET /api/session` saat halaman dimuat; browser mengambilnya otomatis. Server juga menolak `Host` non-loopback (anti DNS rebinding) dan `Origin` lintas situs (anti CSRF). Token dibuat acak setiap server dijalankan dan tidak pernah ditulis ke disk atau dikirim ke layanan lain. Ini lapisan tambahan, bukan pengganti aturan tetap: server hanya boleh di-bind ke `127.0.0.1`.

## Penyimpanan per proyek

Semua data penelitian disimpan **per proyek**, bukan lagi dalam satu berkas di root. Saat server pertama kali dijalankan, `data.json`/`llm_analysis.json` lama otomatis **disalin** (bukan dipindahkan) ke proyek `default`; file lama tetap ada sebagai cadangan.

```
projects/
  index.json                daftar proyek (slug, nama, waktu)
  default/
    meta.json               nama, slug, waktu dibuat/diperbarui
    data.json               postingan + komentar (gitignored)
    llm_analysis.json       hasil analisis LLM (gitignored, opsional)
    failed.json             URL gagal scrape (gitignored, opsional)
    scrape_progress.json    progres scraping sementara (gitignored)
    llm_progress.json       progres analisis LLM sementara (gitignored)
  .trash/                   proyek yang "dihapus" dipindahkan ke sini, bukan lenyap
```

- Kelola proyek di halaman **Pengumpulan Data** (buat/ganti nama/hapus) atau lewat pemilih proyek di header. Semua halaman (Ringkasan, Peta Jaringan, Sentimen) mengikuti proyek aktif lewat parameter `?project=<slug>`; pilihan juga disimpan di `localStorage`.
- Slug hanya huruf kecil/angka/tanda hubung (`default`, `pendukung-a`); server menolak slug lain dan path traversal.
- Berkas yang boleh diakses peramban hanya `data.json` dan `llm_analysis.json` di dalam folder proyek; `meta.json`, progres, dan `failed.json` diblokir. File lintas-proyek dicegah lewat whitelist ketat.
- Penyimpanan **masih berupa JSON** (bukan SQLite) karena data masih kecil (≈0,3 MB) dan viewer berjalan client-side. Modul terpusat `projects.py` menangani list/create/load/save; jika nanti data tumbuh besar (puluhan MB atau >10 ribu komentar), peralihan ke SQLite cukup di lapisan ini.
- `./run.sh analyze` default ke proyek `default`; pakai `PROJECT=nama-proyek ./run.sh analyze` untuk proyek lain, atau `python llm_analyze.py --project nama-proyek`. Tes dan file root lama tetap berfungsi.

## Schema `data.json`

```json
{
  "schema_version": 2,
  "generated_at": "2026-10-07T12:00:00+00:00",
  "posts": [{
    "code": "XXXX", "url": "...", "author": "akun",
    "text": "isi postingan + gabungan thread",
    "timestamp": "2026-10-07T12:34:56+00:00", "timestamp_source": "network",
    "likes": 123,
    "thread":  [{"code": "...", "author": "akun", "text": "...", "timestamp": "...", "likes": null, "parent_code": null}],
    "replies": [{
      "code": "...", "author": "komentator", "text": "...",
      "timestamp": "...", "timestamp_source": "dom", "likes": null,
      "parent_code": "...", "root_code": "XXXX", "depth": 2, "reply_to_author": "akun_lain",
      "first_seen_at": "...", "last_seen_at": "...", "still_present": true
    }],
    "expected_replies": 12, "truncated": false, "stop_reason": "stall",
    "scraped_at": "2026-10-07T12:00:00+00:00",
    "first_scraped_at": "...", "last_scraped_at": "...", "scrape_count": 1
  }]
}
```

- `thread` = lanjutan thread oleh **penulis postingan**. Tidak dibuatkan edge graf; teksnya digabung ke `post.text`.
- `replies` = komentar dari akun lain. Field baru boleh `null`; viewer tetap bisa membaca data lama.
- **Timestamp** diambil berurutan dari: respons JSON internal Threads (`timestamp_source: "network"`), `<time datetime>` (`dom`/`date`), tanggal atau tanggal+jam di DOM, lalu waktu relatif seperti “2 j” yang ditandai `estimated` dan ditampilkan sebagai “(perkiraan)” di panel. Data lama yang hanya punya tanggal tetap bertanda `date`.
- **Pohon balasan**: `parent_code` menunjuk komentar induk, `root_code` postingan/akar, `depth` kedalaman (1 = komentar langsung), dan `reply_to_author` akun yang dibalas. Viewer mengurutkan akar → anak → cucu dan memberi indentasi; data lama tanpa field ini tetap tampil sebagai komentar biasa.
- **Gabung per komentar**: `merge_post` mempertahankan komentar lama, memperbarui yang masih terlihat, dan menambahkan yang baru. `first_seen_at` tidak berubah; `last_seen_at` diperbarui. `still_present` hanya menjadi `false` bila scrape baru lengkap (`complete: true`).
- `expected_replies` berasal dari teks “Lihat N balasan”; `truncated`/`stop_reason` menandai hasil yang terpotong batas atau berhenti karena halaman tidak menambah item.

Data lama (sebelum schema ini) bisa dimigrasi dengan `./run.sh migrate`. Backup otomatis disimpan ke `data.json.bak`. Migrasi memisahkan thread dari komentar, membuang tanggal/`rb tayangan` dari teks, dan mengisi field baru. Aman diulang.

## Viewer

- **Node** = akun. Hijau = pernah memosting, abu = hanya berkomentar. Ukuran mengikuti derajat.
- **Edge**: biru = komentar, oranye = mention `@akun`, ungu = co-comment (dua akun komentar di postingan yang sama; harus diaktifkan).
- Klik node/link untuk detail. Tooltip saat hover. Klik node untuk fokus (tetangga tetap terang); tombol **Isolasi** menampilkan ego-network saja.
- Nama akun di tabel metrik, daftar aktor, kartu postingan, dan detail link bisa diklik → membuka postingan asli di Threads (tab baru). Untuk akun yang hanya berkomentar, tautan mengarah ke postingan tempat ia berpartisipasi; tombol **Buka di Threads** di panel melakukan hal yang sama.
- **Layar penuh** menyembunyikan header, filter, dan panel sehingga hanya peta jaringan yang tampil. Keluar lewat tombol mengambang kanan-atas atau `Esc`.
- Kolom pencarian: saring postingan/komentar/akun, graf ikut berubah, kata kunci disorot.
- Filter: toggle jenis edge, slider derajat minimum, rentang tanggal, warna node per komunitas, dropdown loncat ke akun.
- Panel: peringkat **degree / betweenness / closeness / eigenvector**, ringkasan komunitas Louvain, dan semua postingan.
- **Panel informasi bertab** di kanan peta (grid 8/4 pada layar ≥1280 px): **Metrik | Postingan | Komentar | Anomali**. Tab Postingan menampilkan 10 kartu per halaman, tab Komentar 20 komentar terbaru per halaman, masing-masing punya pencarian sendiri. Diskusi tiap postingan dilipat dan dibuka per 20 komentar supaya panel tidak memanjang puluhan ribu piksel. Di ponsel, peta (420–520 px) dan panel tersusun satu kolom, panel dibatasi 70vh dengan scroll internal.
- **Time-lapse / network replay**: tombol **▶ Putar** memutar pertumbuhan jaringan dari postingan pertama sampai komentar terakhir. Slider **scrub** bisa loncat ke peristiwa tertentu, kecepatan `1× / 5× / 20×` bisa diatur, dan **Jeda** mempertahankan posisi. Waktu diambil dari `timestamp`; yang kosong diisi otomatis berdasarkan tanggal terdekat. Metrik/warna komunitas dihitung sekali dari graf penuh supaya stabil, dan panel menampilkan peristiwa terbaru. Tombol **Kembali ke akhir** mengembalikan graf lengkap.
- Ekspor: CSV node, CSV edge, GraphML (Gephi), PNG, SVG. PNG/SVG mengikuti **seluruh graf** (bbox node + label), tidak terpotong oleh viewport dan tidak dipengaruhi zoom; **Reset zoom** memuat ulang seluruh graf ke dalam viewport. Graf otomatis di-fit setelah simulasi dan saat ukuran kontainer berubah; label akun disembunyikan saat diperkecil agar tidak menutupi node.
- **Snapshot & report export**: **PNG laporan** / **SVG laporan** menghasilkan satu gambar resolusi tinggi berisi graf + panel ringkasan (jumlah postingan/komentar/thread/akun/relasi/komunitas, 5 aktor teratas berdasarkan degree, dan legenda warna edge/node) untuk kebutuhan laporan. PNG laporan dirender sampai ~6000 px pada sisi terpanjang. Ringkasan anomali (klaster CIB, lonjakan, akun skor ≥70) juga ikut tercetak.
- **Timeline komentar**: grafik batang interaktif di bawah peta showing volume komentar per menit/jam/hari (pilihan **Otomatis/Jam/Menit/Hari**). Batang merah = lonjakan terdeteksi (robust median/MAD, leave-one-out). Klik batang untuk melihat akun paling aktif dan contoh komentar pada rentang waktu itu. Bisa disembunyikan.
- **Deteksi anomali & perilaku akun** (tombol **🚨 Anomali**):
  - **CIB**: mengelompokkan komentar identik/mirip dari minimal 3 akun berbeda dalam jendela 5/10/30 menit (diatur di panel). Teks dinormalisasi (abaikan `@mention`, URL, tanda baca, emoji, urutan kata) lalu dicocokkan dengan Jaccard ≥ 0,8.
  - **Skor buzzer** 0–100 dengan alasan yang jelas: 0 postingan tapi banyak komentar, teks berulang, hanya menargetkan satu akun, keterlibatan dalam klaster CIB, komentar sangat pendek, dan laju komentar per hari aktif. Akun berisiko bisa disorot di graf (lingkaran merah ≥70, kuning ≥40) lewat checkbox **sorot akun berisiko**.
  - Panel juga bisa mengubah jendela CIB/min akun, menghitung ulang, loncat ke akun, dan membuka detail bucket waktu.
  - **Catatan**: ini heuristik untuk triase, bukan bukti. Usia akun tidak bisa dinilai karena `data.json` tidak punya tanggal pembuatan akun; deteksi detik/menit memerlukan `timestamp` ISO lengkap dari scraper (data lama bertanggal saja ditandai keyakinan lebih rendah).
- Viewer memuat `data.json` otomatis; tanpa file itu, data contoh tampil dengan banner peringatan. Bisa juga tombol **Muat data.json**.
- Logika graf murni (build, metrik, Louvain) ada di `viewer_core.js`; bisa dipakai dari Node lewat `require('./viewer_core.js')`.

## Tampilan dashboard (React + Tailwind)

Aplikasi adalah SPA React + Vite + Tailwind CSS v4 yang dibangun ke `dist/` dengan satu shell bertab (gaya visual terinspirasi template *NusaPulse — Social Media Monitoring & SNA*, dire-implementasi; komponen UI dasar tetap diadaptasi dari [Mosaic Lite](https://github.com/cruip/tailwind-dashboard-template), GPL-3.0). Palet slate/biru, font Plus Jakarta Sans/DM Sans/JetBrains Mono, sidebar 248 px, header dengan breadcrumb · pencarian · aksi utama, konten `max-w-[1440px]`.

Tab utama:
- **Ringkasan** — KPI postingan/komentar/aktor/relasi, tren volume, proporsi sentimen, aktor utama, topik dominan, deteksi CIB, dan panel **Ringkasan AI** (narasi ringkas sisi klien dari statistik proyek; bukan hasil analisis per komentar).
- **Peta Jaringan** — semua fitur viewer (D3 force graph, filter, fokus/isolasi, time-lapse, anomali/CIB/buzzer, timeline, ekspor, toolbar, rail info). Kompatibel dengan deep-link lama `/viewer.html?focus=<akun>` (membuka tab Peta Jaringan dan memfokuskan akun).
- **Sentimen** — feed label per komentar (sentimen/emosi/topik/toksisitas/spam), filter/pencarian/urut/ekspor CSV, serta sidebar proporsi, topik, kata kunci, dan info dataset.
- **Sumber & Proyek** — ingesti & pengumpulan data (login, scraping, progres), manajemen proyek pemantauan, dan **Impor & Cadangkan Dataset JSON** (unduh `data.json` dan `llm_analysis.json` per proyek).

Struktur kode: `src/App.jsx` (shell/routing tab via path + `?tab=`), `src/components/Layout.jsx` (sidebar/header, pemilih proyek, toggle tema, aksi **Analisis AI**), `src/pages/{SummaryPage,ViewerPage,SentimentPage,ScrapePage}.jsx` sebagai view per tab, komponen pendukung di `src/components/`, utilitas di `src/lib/`. `viewer_core.js` tetap dipakai apa adanya (UMD) agar test Node tidak berubah.

Header memuat **pencarian global** akun/postingan, pemilih proyek, dan tombol **Analisis AI** (menjalankan `POST /api/analyze` untuk proyek aktif dan memantau `/api/status`; label AI tetap triase, bukan bukti). Memilih hasil pencarian membuka Peta Jaringan dan memfokuskan akun (`/viewer.html?focus=<akun>`). Toggle tema gelap/terang ada di sidebar.

`llm_server.py` menyajikan `dist/` bila sudah dibangun: `/`, `/index.html`, `/ringkasan.html`, `/viewer.html`, `/sentimen.html`, dan `/scrape.html` memuat `index.html` yang sama, aset dari `/assets/`, sementara `data.json` dan `llm_analysis.json` per proyek disajikan dari `projects/<slug>/` (hanya dua nama berkas itu yang boleh diakses, dan hanya dari folder proyek yang valid). Sebelum `npm run build`, server fallback ke file HTML lama. `node_modules/` dan `dist/` tidak masuk git. Server yang sama juga menjadi API lokal untuk analisis LLM **dan** pengumpulan data.

**Batasan/catatan UI:** impor dataset tulis ke server belum tersedia sebagai endpoint; untuk memuat data lain gunakan “Muat data.json” di tab Peta Jaringan (sesi lokal browser) atau salin berkas ke `projects/<slug>/` saat server dimatikan. Fitur Live Stream dan simulasi tidak disertakan. Atribusi Mosaic Lite (GPL-3.0) tetap dipertahankan di footer dan dokumentasi.

## Analisis konten (LLM)

Graf menjawab **siapa bicara dengan siapa**; bagian ini menjawab **apa yang mereka bicarakan** dan **bagaimana nadanya**. Analisis tetap dijalankan sebagai proses lokal (bukan di browser), tetapi bisa dipicu langsung dari halaman sentimen lewat server lokal kecil di `llm_server.py`:

```bash
cp .env.example .env          # lalu isi LLM_API_KEY (dan base URL/model bila perlu)
./run.sh serve                # otomatis menyalakan server lokal + buka http://localhost:8000/sentimen.html
# lalu klik tombol ▶ Jalankan analisis di halaman tersebut

./run.sh analyze              # alternatif lewat terminal: baca proyek `default` -> llm_analysis.json
./run.sh analyze --limit 100  # hanya 100 komentar pertama (uji cepat)
./run.sh analyze --dry-run    # lihat rencana tanpa memanggil API
```

- `./run.sh serve` menjalankan `llm_server.py`, yaitu server statis **sekaligus** API analisis dan API pengumpulan data dalam satu proses (menggantikan `python -m http.server`). Jadi server lokal kecil itu ikut berjalan otomatis—tidak perlu perintah terpisah—dan tombol **Analisis AI**/analisis langsung berfungsi.
- Kredensial dibaca dari `.env` oleh `llm_analyze.py` dan **tidak pernah dikirim ke browser**. Tombol **Analisis AI** di header (atau tombol analisis di halaman Sentimen) hanya mengirim perintah (opsi `limit`, batch, timeout) ke `/api/analyze` pada server lokal; server yang menjalankan skrip dan menulis `llm_analysis.json` (gitignored). Server juga menyembunyikan `.env` dari `fetch` statis. Panel "Ringkasan AI" di tab Ringkasan adalah narasi ringkas sisi klien dari statistik proyek, bukan hasil label per-komentar.
- Progres batch ditampilkan di halaman lewat `/api/status` (file progres sementara `llm_progress.json`, gitignored). Analisis yang sudah berjalan—termasuk yang dipicu dari terminal—tidak bisa dijalankan dua kali bersamaan; halaman akan menampilkan statusnya.
- `viewer.html` tidak memuat hasil LLM sama sekali, sehingga peta jaringan tetap berfungsi normal walaupun analisis belum dijalankan. Bila server analisis tidak tersedia (misal halaman dibuka dengan `python -m http.server` biasa), halaman sentimen tetap bisa menampilkan hasil lama atau memuat berkas manual.
- Model/config: `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL=cmd`, `LLM_BATCH_SIZE`, `LLM_TIMEOUT`, `LLM_MAX_TOKENS`. Nilai bawaan ada di `.env.example`. Model `cmd` di gateway ini adalah model *thinking*, jadi `LLM_MAX_TOKENS` perlu besar (≈8000); nilai kecil memotong JSON sebelum selesai.
- Kunci tiap komentar memakai FNV-1a 64-bit yang identik di Python (`content_key`) dan browser (`SNA.contentKey`), jadi hasil LLM bisa dicocokkan dengan komentar di `data.json` secara sinkron tanpa menyimpan teks mentah di hasil analisis.
- Topik dibuat sekali dari sampel teks terpanjang, lalu tiap batch komentar diberi label `sentiment` (positif/negatif/netral), `emotion`, `toxicity` (0–1), `spam`, dan `topic` dalam satu panggilan.

### Mode lokal tanpa API: IndoBERTweet

Kalau tidak mau memakai API LLM, sentimen bisa dilabeli sepenuhnya offline dengan model IndoBERTweet (`Aardiiiiy/indobertweet-base-Indonesian-sentiment-analysis`). Tidak ada panggilan jaringan dan tidak perlu `LLM_API_KEY`.

```bash
.venv/bin/pip install torch transformers sentencepiece   # sekali saja; untuk GPU pakai build CUDA (lihat di bawah)
./run.sh analyze --engine indobert                       # atau: SENTIMENT_ENGINE=indobert di .env
.venv/bin/python llm_analyze.py --engine indobert --limit 20 --dry-run
```

Batasan yang perlu diketahui sebelum memilih mode ini:

- **Hanya label sentimen.** Model ini 3 kelas (`Negative`/`Neutral`/`Positive`), jadi hanya field `sentiment` yang terisi. `emotion`, `toxicity`, `spam`, dan `topic` ditulis kosong — bukan ditebak — sehingga filter emosi/toksisitas di halaman sentimen tidak akan menemukan apa pun. Kolom `confidence` ditambahkan berisi probabilitas kelas terpilih.
- **Tanpa topik otomatis.** Pembuatan topik dan kata kunci tetap butuh LLM; di mode ini daftar topik kosong dan kata kunci tidak dihasilkan.
- **Domain berbeda.** Model dilatih pada tweet berbahasa Indonesia (politik, bencana, pendidikan), bukan Threads. Sarkasme, singkatan baru, dan campur kode Inggris masih jadi titik lemah; perlakukan hasilnya sebagai triase kasar.
- **GPU dipakai otomatis.** Device dipilih sendiri: `cuda` bila tersedia, `cpu` bila tidak. Paksa dengan `--device cuda:0` atau `--device cpu`, atau set `INDOBERT_DEVICE` di `.env`. Untuk GPU, torch harus build CUDA — build `+cpu` tidak akan melihat kartu grafis:
  ```bash
  .venv/bin/pip install --index-url https://download.pytorch.org/whl/cu130 torch
  ```
  Bobot model (~500 MB) diunduh sekali ke cache Hugging Face lalu dipakai offline.
- Hasil tetap ditulis ke `llm_analysis.json` dengan `model` berisi nama model IndoBERT, jadi asal label tetap bisa diaudit dan dibedakan dari hasil LLM.

Kedua mode bisa dipakai bergantian pada proyek yang sama; menjalankan ulang akan menimpa `llm_analysis.json` proyek tersebut.

### Halaman sentimen (terpisah dari viewer)

Buka `http://localhost:8000/sentimen.html` setelah menjalankan `./run.sh serve`. Halaman ini **tidak dijadikan satu dengan viewer** dan menampilkan:

- **Label sentimen per komentar** — setiap baris daftar memuat badge **＋ Positif / － Negatif / ＝ Netral**, emosi, topik, skor toksisitas, dan penanda spam, lengkap dengan teks asli, akun, postingan asal, waktu, serta alasan singkat dari model.
- Ringkasan agregat (jumlah dan persentase positif/netral/negatif, toksik, spam) dan daftar topik beserta kata kuncinya.
- Filter sentimen, emosi, topik, toksisitas/spam, dan pencarian teks/akun; pengurutan terbaru/terlama/toksisitas/akun; **Ekspor CSV** untuk hasil filter.
- Kata kunci yang disorot di teks komentar dan tombol memuat `data.json` / `llm_analysis.json` manual bila halaman dibuka tanpa server.

**Catatan**: label LLM (sentimen, emosi, toksisitas, spam) adalah bantuan triase, **bukan penilaian final**. Selalu verifikasi manual komentar yang ditandai, terutama sarkasme dan tuduhan. Akurasi sangat bergantung pada kualitas teks hasil scrape dan perilaku model; simpan hasil dengan `generated_at`/`model` untuk audit.

## Pemecahan masalah

- Banner **"Gagal memuat data.json (Failed to fetch)"** → halaman dibuka langsung dengan `file://`. Browser memblokir `fetch` lokal; jalankan `./run.sh serve` lalu buka `http://localhost:8000/viewer.html` atau `http://localhost:8000/sentimen.html`. Di halaman sentimen, berkas juga bisa dimuat manual lewat tombol di header.
- Banner **"File JSON tidak valid"** → file yang dipilih benar-benar bukan JSON. Pilih `data.json` yang dihasilkan scraper (bukan `data.json.bak`), atau cek cepat dengan `node -e "JSON.parse(require('fs').readFileSync('data.json','utf8'))"`.
- Banner **"data.json terbaca, tetapi gagal dirender: …"** → JSON valid tapi ada error saat menggambar graf (mis. selector/field berubah). Pesan ini sengaja dibedakan dari error JSON agar mudah didiagnosis.
- **`ERR_HTTP_RESPONSE_CODE_FAILURE` atau HTTP 429 saat login** → Threads/Meta sedang membatasi IP Anda (body respons kosong). Program sekarang menampilkan pesan yang jelas, bukan traceback. Cek `curl -s -o /dev/null -w '%{http_code}\n' https://www.threads.com/login`; jika `429`, tunggu 30–60 menit, jangan login berulang-ulang. Jika tetap 429, ganti jaringan (tethering HP/ISP lain). Captcha yang gagal berulang juga dipengaruhi reputasi IP dan fingerprint browser, bukan hanya jawaban gambar.

## Catatan

- Selector berbasis pola link `/@user/post/kode`; jika Threads mengubah halaman, sesuaikan `JS_EXTRACT` di `scrape_threads.py`. Jalankan dengan `--show` untuk melihat browser.
- Scroll berhenti otomatis setelah beberapa putaran tanpa item baru, atau setelah `--max-replies` tercapai. Jeda antar postingan bisa diatur supaya tidak memicu rate limit.
- Scraping melanggar ketentuan layanan Meta; pakai akun cadangan dan jeda wajar.
- Rincian pekerjaan ada di `ROADMAP.md`.
- Lisensi proyek: **GPL-3.0** (`LICENSE`). Komponen UI dasar diadaptasi dari [Mosaic Lite](https://github.com/cruip/tailwind-dashboard-template) oleh Cruip (GPL-3.0, © 2020 Cruip); gaya visual shell/tab terinspirasi template *NusaPulse* (pola dire-implementasi, bukan salin kode verbatim; template tanpa lisensi terlampir). Atribusi Mosaic Lite tercantum di footer aplikasi. Template tidak di-republish atau dijual kembali.
