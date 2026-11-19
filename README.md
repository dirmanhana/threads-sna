# Threads SNA

Ambil postingan dan komentar dari Threads dengan Playwright, lalu lihat jaringannya: siapa posting apa, siapa mengomentari, siapa menyebut siapa. Semua proses berjalan lokal; pengumpulan data bisa dipicu lewat terminal **atau langsung dari browser**.

## Instalasi

```bash
chmod +x install.sh && ./install.sh
```

Satu perintah ini menyiapkan **semua tahapan**:

1. Cek prasyarat: Python 3, **Node.js 20+**, dan npm.
2. Buat `.venv` lalu install paket dari `requirements.txt` (Playwright).
3. Install browser Chromium untuk Playwright.
4. Install dependensi Node (`npm ci` bila `package-lock.json` ada, sebaliknya `npm install`).
5. Build dashboard React + Tailwind ke `dist/` (`npm run build`).
6. Buat `.env` dari `.env.example` bila belum ada (tidak pernah menimpa kredensial yang sudah diisi).
7. Verifikasi dengan unit test Python + Node.

Opsi environment: `WITH_DEPS=1` (library sistem Chromium, butuh sudo di Linux), `SKIP_BROWSER=1`, `SKIP_BUILD=1`, `SKIP_TESTS=1`, dan `PYTHON=python3.12` untuk memilih interpreter.

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
./run.sh migrate                            # migrasi data.json lama ke schema baru
./run.sh analyze                            # analisis konten via LLM -> llm_analysis.json
./run.sh analyze --limit 100 --dry-run      # cek rencana tanpa panggil API
./run.sh test                               # unit test (Python + Node)
```

Opsi lanjutan lewat `scrape_threads.py` langsung: `--out`, `--delay` (jeda dasar antar postingan, detik), `--max-replies`, `--profile-dir`, `--show`. Lewat `run.sh` bisa diatur dengan env: `OUT=nama.json DELAY=5 PROFILE_DIR=./akun_lain ./run.sh keyword "umkm"`.

Hasil disimpan ke `data.json` dan **digabung** dengan data lama (berdasarkan kode postingan). Saat opsi gabung aktif, komentar yang sudah ada tidak dibuang walaupun tidak terlihat lagi pada scrape baru; item seperti itu hanya ditandai `still_present: false` bila scrape baru benar-benar lengkap. URL yang gagal dicatat ke `failed.json`. Jika semua postingan gagal dibaca, file hasil tidak ditimpa dan akan muncul peringatan kemungkinan sesi login kedaluwarsa.

### Pengumpulan data dari browser (tanpa terminal)

Jalankan `./run.sh serve` sekali, lalu buka **`http://localhost:8000/scrape.html`**. Halaman "Pengumpulan Data" di sidebar menyediakan alur lengkap:

1. **Login** — tombol "Buka browser login" menyuruh server lokal membuka Chromium tampak. Login manual di jendela itu; deteksi cookie `.threads.com` berjalan otomatis. Tombol "Saya sudah login" hanya fallback. Sesi tersimpan di `threads_profile/` (gitignored) dan **tidak pernah dikirim ke browser**.
2. **Ambil data** — pilih profil / kata kunci / URL postingan, jumlah postingan, batas komentar, dan opsi **gabungkan atau timpa** data lama. Opsi timpa tetap membuat backup `data.json.bak` sebelum menulis.
3. **Pantau progres** — jumlah postingan yang selesai, pesan, dan log ditampilkan langsung. Job berjalan di server, jadi halaman boleh ditutup dan dibuka lagi.
4. **Pakai hasilnya** — tombol "Buka di peta jaringan" memuat `data.json` yang baru.

Catatan: scraper tetap memakai Playwright sungguhan, jadi **login pertama memerlukan desktop dengan tampilan Chromium**. Di server headless murni, lakukan `./run.sh login` sekali lewat terminal. Endpoint hanya di-bind ke `127.0.0.1` — jangan diubah ke `0.0.0.0` karena itu akan memungkinkan pihak lain memicu browser dengan sesi Anda.

API yang dipakai halaman ini: `GET /api/scrape/status`, `POST /api/scrape/start`, `/api/scrape/cancel`, `GET /api/login/status`, `POST /api/login/start`, `/api/login/confirm`, `/api/login/cancel`. `scrape_progress.json`, `login_progress.json`, dan `login_selesai.marker` adalah file sementara (gitignored) dan diblokir dari akses statis.

**Keamanan API lokal:** semua `POST` wajib membawa header `X-SNA-Token` yang diberikan `GET /api/session` saat halaman dimuat; browser mengambilnya otomatis. Server juga menolak `Host` non-loopback (anti DNS rebinding) dan `Origin` lintas situs (anti CSRF). Token dibuat acak setiap server dijalankan dan tidak pernah ditulis ke disk atau dikirim ke layanan lain. Ini lapisan tambahan, bukan pengganti aturan tetap: server hanya boleh di-bind ke `127.0.0.1`.

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

Ketiga halaman sekarang adalah satu aplikasi React + Vite + Tailwind CSS v4 yang dibangun ke `dist/`. Tata letaknya mengikuti kerangka **Mosaic Lite** (sidebar bergrup, header 64 px, judul halaman 30 px, grid 12 kolom, kartu `rounded-xl`):

- `src/pages/SummaryPage.jsx` — **Ringkasan** (beranda `/`): KPI postingan/komentar/akun/relasi, grafik volume komentar, donut sentimen, tabel aktor teratas, aktivitas terakhir, sinyal risiko (toksik/spam/lonjakan), dan topik LLM.
- `src/pages/ViewerPage.jsx` — peta jaringan + semua fitur viewer di atas (D3 force graph, filter, panel, time-lapse, anomali, timeline, ekspor).
- `src/pages/SentimentPage.jsx` — halaman label sentimen per komentar.
- `src/pages/ScrapePage.jsx` — pengumpulan data: login, form scraping, progres, dan ringkasan `data.json`.
- `src/components/` — `Layout` (sidebar/header/pencarian global), `PageHeader`, `Card`, `KpiCard`, `StatusPill`, `EmptyState`, `MiniCharts` (bar/donut tanpa Chart.js), kanvas graf, timeline, dan panel informasi bertab.
- `src/lib/` — helper murni, utilitas fetch/unduh, dan modul ekspor; `viewer_core.js` tetap dipakai apa adanya supaya test Node tidak berubah.
- `src/App.jsx` memilih halaman dari `pathname`: `/sentimen.html` → sentimen, `/scrape.html` → pengumpulan data, `/viewer.html` → peta, selain itu (`/`, `/ringkasan.html`, `/index.html`) → Ringkasan.

Header memuat **pencarian global** akun/postingan; memilih hasil membuka `/viewer.html?focus=<akun>` dan langsung memfokuskan akun itu. Toggle tema ada di header, dan sidebar bisa diringkas (80 px) atau dilebarkan (256 px).

`llm_server.py` menyajikan `dist/` bila sudah dibangun: `/`, `/index.html`, `/ringkasan.html`, `/viewer.html`, `/sentimen.html`, dan `/scrape.html` memuat `index.html` yang sama, aset dari `/assets/`, sementara `data.json` dan `llm_analysis.json` tetap dibaca dari root proyek. Sebelum `npm run build`, server fallback ke file HTML lama. `node_modules/` dan `dist/` tidak masuk git. Server yang sama juga menjadi API lokal untuk analisis LLM **dan** pengumpulan data.

## Analisis konten (LLM)

Graf menjawab **siapa bicara dengan siapa**; bagian ini menjawab **apa yang mereka bicarakan** dan **bagaimana nadanya**. Analisis tetap dijalankan sebagai proses lokal (bukan di browser), tetapi bisa dipicu langsung dari halaman sentimen lewat server lokal kecil di `llm_server.py`:

```bash
cp .env.example .env          # lalu isi LLM_API_KEY (dan base URL/model bila perlu)
./run.sh serve                # otomatis menyalakan server lokal + buka http://localhost:8000/sentimen.html
# lalu klik tombol ▶ Jalankan analisis di halaman tersebut

./run.sh analyze              # alternatif lewat terminal: baca data.json -> llm_analysis.json
./run.sh analyze --limit 100  # hanya 100 komentar pertama (uji cepat)
./run.sh analyze --dry-run    # lihat rencana tanpa memanggil API
```

- `./run.sh serve` menjalankan `llm_server.py`, yaitu server statis **sekaligus** API analisis dan API pengumpulan data dalam satu proses (menggantikan `python -m http.server`). Jadi server lokal kecil itu ikut berjalan otomatis—tidak perlu perintah terpisah—dan tombol analisis/scraping langsung berfungsi.
- Kredensial dibaca dari `.env` oleh `llm_analyze.py` dan **tidak pernah dikirim ke browser**. Tombol **▶ Jalankan analisis** hanya mengirim perintah (opsi `limit`, batch, timeout) ke `/api/analyze` pada server lokal; server yang menjalankan skrip dan menulis `llm_analysis.json` (gitignored). Server juga menyembunyikan `.env` dari `fetch` statis.
- Progres batch ditampilkan di halaman lewat `/api/status` (file progres sementara `llm_progress.json`, gitignored). Analisis yang sudah berjalan—termasuk yang dipicu dari terminal—tidak bisa dijalankan dua kali bersamaan; halaman akan menampilkan statusnya.
- `viewer.html` tidak memuat hasil LLM sama sekali, sehingga peta jaringan tetap berfungsi normal walaupun analisis belum dijalankan. Bila server analisis tidak tersedia (misal halaman dibuka dengan `python -m http.server` biasa), halaman sentimen tetap bisa menampilkan hasil lama atau memuat berkas manual.
- Model/config: `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL=cmd`, `LLM_BATCH_SIZE`, `LLM_TIMEOUT`, `LLM_MAX_TOKENS`. Nilai bawaan ada di `.env.example`. Model `cmd` di gateway ini adalah model *thinking*, jadi `LLM_MAX_TOKENS` perlu besar (≈8000); nilai kecil memotong JSON sebelum selesai.
- Kunci tiap komentar memakai FNV-1a 64-bit yang identik di Python (`content_key`) dan browser (`SNA.contentKey`), jadi hasil LLM bisa dicocokkan dengan komentar di `data.json` secara sinkron tanpa menyimpan teks mentah di hasil analisis.
- Topik dibuat sekali dari sampel teks terpanjang, lalu tiap batch komentar diberi label `sentiment` (positif/negatif/netral), `emotion`, `toxicity` (0–1), `spam`, dan `topic` dalam satu panggilan.

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

## Catatan

- Selector berbasis pola link `/@user/post/kode`; jika Threads mengubah halaman, sesuaikan `JS_EXTRACT` di `scrape_threads.py`. Jalankan dengan `--show` untuk melihat browser.
- Scroll berhenti otomatis setelah beberapa putaran tanpa item baru, atau setelah `--max-replies` tercapai. Jeda antar postingan bisa diatur supaya tidak memicu rate limit.
- Scraping melanggar ketentuan layanan Meta; pakai akun cadangan dan jeda wajar.
- Rincian pekerjaan ada di `ROADMAP.md`.
- Lisensi proyek: **GPL-3.0** (`LICENSE`). Tampilan dashboard terinspirasi [Mosaic Lite](https://github.com/cruip/tailwind-dashboard-template) oleh Cruip (GPL-3.0, © 2020 Cruip); atribusi juga tercantum di footer aplikasi. Template tidak di-republish atau dijual kembali.
