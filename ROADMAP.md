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

## Perbaikan lanjutan
- [x] Bug: akun yang hanya disebut (@mention) tidak punya node → `d3.forceLink` melempar `node not found`, yang salah dilaporkan sebagai "Gagal memuat data.json" / "JSON tidak valid"
- [x] Pisahkan error parse JSON vs error render di banner viewer; beri petunjuk `./run.sh serve` kalau `fetch` diblokir
- [x] Tambah test regresi mention-only node (13 test Node)

## Verifikasi
- `./run.sh test` → 8 test Python + 13 test Node lulus
- Uji browser headless: data.json termuat via HTTP **dan** via input file; `file://` menampilkan petunjuk serve; JSON rusak tetap terdeteksi; toggle co-comment tanpa page error
- `SNA.build(data.posts)` → 665 akun · 753 relasi · 20 komunitas (default)
- Filter tanggal & toggle co-comment sudah diuji terhadap data nyata
- Uji browser headless time-lapse: play/jeda stabil, scrub 60 → 60/903, kembali ke akhir → 903/903 tanpa page error
- Uji browser headless laporan: SVG mengandung judul/legenda/statistik/aktor teratas; PNG laporan 6000 px tanpa page error

## Catatan
- `parent_code` diisi best-effort dari quote-reply; balasan bersarang belum sepenuhnya dibedakan.
- Data lama yang belum punya `timestamp` tidak ikut tersaring saat filter tanggal aktif.
