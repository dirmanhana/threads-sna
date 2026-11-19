#!/usr/bin/env bash
# Pembungkus: otomatis memakai .venv.
#   ./run.sh login                                  # login manual sekali
#   ./run.sh profile <akun> [jumlah_post] [max_komentar]
#   ./run.sh keyword "<kata kunci>" [jumlah_post] [max_komentar]
#   ./run.sh post <url_postingan> [max_komentar]
#   ./run.sh serve [port]                           # viewer di http://localhost:8000/viewer.html
#   ./run.sh migrate                                # migrasi data.json lama ke schema baru
#   ./run.sh test                                   # jalankan unit test
# Variabel lingkungan: OUT=..., DELAY=..., PROFILE_DIR=...
set -euo pipefail
cd "$(dirname "$0")"
[ -d .venv ] || { echo "Jalankan ./install.sh dulu."; exit 1; }
# shellcheck disable=SC1091
source .venv/bin/activate

OUT="${OUT:-data.json}"; DELAY="${DELAY:-3}"; PROFILE_DIR="${PROFILE_DIR:-./threads_profile}"
scrape() { python scrape_threads.py "$@" --out "$OUT" --delay "$DELAY" --profile-dir "$PROFILE_DIR"; }

cmd="${1:-}"; shift || true
case "$cmd" in
  login)   scrape login ;;
  profile) scrape profile "${1:?akun belum diisi}" --max-posts "${2:-10}" --max-replies "${3:-400}" ;;
  keyword) scrape keyword "${1:?kata kunci belum diisi}" --max-posts "${2:-15}" --max-replies "${3:-400}" ;;
  post)    scrape post "${1:?url belum diisi}" --max-replies "${2:-400}" ;;
  serve)   port="${1:-8000}"; echo "Buka http://localhost:$port/viewer.html"; python -m http.server "$port" ;;
  migrate) python migrate_data.py --src "$OUT" ;;
  test)
    python -m unittest discover -s tests -p 'test_core.py'
    if command -v node >/dev/null 2>&1; then node --test tests/test_viewer.mjs; else echo "node tidak ada; lewati test viewer."; fi
    ;;
  *) sed -n '2,10p' "$0"; exit 1 ;;
esac
