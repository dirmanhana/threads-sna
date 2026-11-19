# Threads SNA

Ambil postingan dan komentar dari Threads dengan Playwright, lalu lihat jaringannya: siapa posting apa, siapa mengomentari, siapa menyebut siapa. Viewer berjalan lokal di browser, tanpa backend.

## Instalasi

```bash
chmod +x install.sh && ./install.sh
```

Membuat `.venv`, meng-install Playwright dan Chromium. Jika Chromium gagal jalan di Linux karena library sistem: `WITH_DEPS=1 ./install.sh` (butuh sudo).

## Pemakaian

```bash
./run.sh login                              # sekali saja, login manual di browser yang terbuka
./run.sh keyword "umkm" 15 400              # cari kata kunci, 15 postingan, maks 400 komentar/post
./run.sh profile akun_target 10             # atau ambil dari satu profil
./run.sh post https://www.threads.com/@akun/post/XXXX
./run.sh serve                              # buka http://localhost:8000/viewer.html
./run.sh migrate                            # migrasi data.json lama ke schema baru
./run.sh test                               # unit test (Python + Node)
```

Opsi lanjutan lewat `scrape_threads.py` langsung: `--out`, `--delay` (jeda dasar antar postingan, detik), `--max-replies`, `--profile-dir`, `--show`. Lewat `run.sh` bisa diatur dengan env: `OUT=nama.json DELAY=5 PROFILE_DIR=./akun_lain ./run.sh keyword "umkm"`.

Hasil disimpan ke `data.json` dan **digabung** dengan data lama (berdasarkan kode postingan). URL yang gagal dicatat ke `failed.json`. Jika semua postingan gagal dibaca, file hasil tidak ditimpa dan akan muncul peringatan kemungkinan sesi login kedaluwarsa.

## Schema `data.json`

```json
{
  "posts": [{
    "code": "XXXX", "url": "...", "author": "akun",
    "text": "isi postingan + gabungan thread",
    "timestamp": "2026-10-07", "likes": 123,
    "thread":  [{"code": "...", "author": "akun", "text": "...", "timestamp": "...", "likes": null, "parent_code": null}],
    "replies": [{"code": "...", "author": "komentator", "text": "...", "timestamp": "...", "likes": null, "parent_code": null}],
    "scraped_at": "2026-10-07T12:00:00+00:00"
  }]
}
```

- `thread` = lanjutan thread oleh **penulis postingan**. Tidak dibuatkan edge graf; teksnya digabung ke `post.text`.
- `replies` = komentar dari akun lain. Field baru (`timestamp`, `likes`, `parent_code`) boleh `null`; viewer tetap bisa membaca data lama.
- `parent_code` diisi best-effort dari cuplikan quote-reply; balasan bersarang belum sepenuhnya dibedakan.

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
- **Time-lapse / network replay**: tombol **▶ Putar** memutar pertumbuhan jaringan dari postingan pertama sampai komentar terakhir. Slider **scrub** bisa loncat ke peristiwa tertentu, kecepatan `1× / 5× / 20×` bisa diatur, dan **Jeda** mempertahankan posisi. Waktu diambil dari `timestamp`; yang kosong diisi otomatis berdasarkan tanggal terdekat. Metrik/warna komunitas dihitung sekali dari graf penuh supaya stabil, dan panel menampilkan peristiwa terbaru. Tombol **Kembali ke akhir** mengembalikan graf lengkap.
- Ekspor: CSV node, CSV edge, GraphML (Gephi), PNG, SVG. PNG/SVG mengikuti **seluruh graf** (bbox node + label), tidak terpotong oleh viewport dan tidak dipengaruhi zoom; **Reset zoom** mengembalikan viewport.
- **Snapshot & report export**: **PNG laporan** / **SVG laporan** menghasilkan satu gambar resolusi tinggi berisi graf + panel ringkasan (jumlah postingan/komentar/thread/akun/relasi/komunitas, 5 aktor teratas berdasarkan degree, dan legenda warna edge/node) untuk kebutuhan laporan. PNG laporan dirender sampai ~6000 px pada sisi terpanjang. Ringkasan anomali (klaster CIB, lonjakan, akun skor ≥70) juga ikut tercetak.
- **Timeline komentar**: grafik batang interaktif di bawah peta showing volume komentar per menit/jam/hari (pilihan **Otomatis/Jam/Menit/Hari**). Batang merah = lonjakan terdeteksi (robust median/MAD, leave-one-out). Klik batang untuk melihat akun paling aktif dan contoh komentar pada rentang waktu itu. Bisa disembunyikan.
- **Deteksi anomali & perilaku akun** (tombol **🚨 Anomali**):
  - **CIB**: mengelompokkan komentar identik/mirip dari minimal 3 akun berbeda dalam jendela 5/10/30 menit (diatur di panel). Teks dinormalisasi (abaikan `@mention`, URL, tanda baca, emoji, urutan kata) lalu dicocokkan dengan Jaccard ≥ 0,8.
  - **Skor buzzer** 0–100 dengan alasan yang jelas: 0 postingan tapi banyak komentar, teks berulang, hanya menargetkan satu akun, keterlibatan dalam klaster CIB, komentar sangat pendek, dan laju komentar per hari aktif. Akun berisiko bisa disorot di graf (lingkaran merah ≥70, kuning ≥40) lewat checkbox **sorot akun berisiko**.
  - Panel juga bisa mengubah jendela CIB/min akun, menghitung ulang, loncat ke akun, dan membuka detail bucket waktu.
  - **Catatan**: ini heuristik untuk triase, bukan bukti. Usia akun tidak bisa dinilai karena `data.json` tidak punya tanggal pembuatan akun; deteksi detik/menit memerlukan `timestamp` ISO lengkap dari scraper (data lama bertanggal saja ditandai keyakinan lebih rendah).
- Viewer memuat `data.json` otomatis; tanpa file itu, data contoh tampil dengan banner peringatan. Bisa juga tombol **Muat data.json**.
- Logika graf murni (build, metrik, Louvain) ada di `viewer_core.js`; bisa dipakai dari Node lewat `require('./viewer_core.js')`.

## Pemecahan masalah

- Banner **"Gagal memuat data.json (Failed to fetch)"** →viewer dibuka langsung dengan `file://`. Browser memblokir `fetch` lokal; jalankan `./run.sh serve` lalu buka `http://localhost:8000/viewer.html`.
- Banner **"File JSON tidak valid"** → file yang dipilih benar-benar bukan JSON. Pilih `data.json` yang dihasilkan scraper (bukan `data.json.bak`), atau cek cepat dengan `node -e "JSON.parse(require('fs').readFileSync('data.json','utf8'))"`.
- Banner **"data.json terbaca, tetapi gagal dirender: …"** → JSON valid tapi ada error saat menggambar graf (mis. selector/field berubah). Pesan ini sengaja dibedakan dari error JSON agar mudah didiagnosis.

## Catatan

- Selector berbasis pola link `/@user/post/kode`; jika Threads mengubah halaman, sesuaikan `JS_EXTRACT` di `scrape_threads.py`. Jalankan dengan `--show` untuk melihat browser.
- Scroll berhenti otomatis setelah beberapa putaran tanpa item baru, atau setelah `--max-replies` tercapai. Jeda antar postingan bisa diatur supaya tidak memicu rate limit.
- Scraping melanggar ketentuan layanan Meta; pakai akun cadangan dan jeda wajar.
- Rincian pekerjaan ada di `ROADMAP.md`.
