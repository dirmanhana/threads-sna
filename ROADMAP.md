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

## Perbaikan lanjutan
- [x] Bug: akun yang hanya disebut (@mention) tidak punya node → `d3.forceLink` melempar `node not found`, yang salah dilaporkan sebagai "Gagal memuat data.json" / "JSON tidak valid"
- [x] Pisahkan error parse JSON vs error render di banner viewer; beri petunjuk `./run.sh serve` kalau `fetch` diblokir
- [x] Tambah test regresi mention-only node (13 test Node)

## Verifikasi
- `./run.sh test` → 8 test Python + 13 test Node lulus
- Uji browser headless: data.json termuat via HTTP **dan** via input file; `file://` menampilkan petunjuk serve; JSON rusak tetap terdeteksi; toggle co-comment tanpa page error
- `SNA.build(data.posts)` → 665 akun · 753 relasi · 20 komunitas (default)
- Filter tanggal & toggle co-comment sudah diuji terhadap data nyata

## Catatan
- `parent_code` diisi best-effort dari quote-reply; balasan bersarang belum sepenuhnya dibedakan.
- Data lama yang belum punya `timestamp` tidak ikut tersaring saat filter tanggal aktif.
