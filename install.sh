#!/usr/bin/env bash
# Install semua kebutuhan: .venv, paket Python, dan browser Chromium untuk Playwright.
set -euo pipefail
cd "$(dirname "$0")"

PY="${PYTHON:-python3}"
command -v "$PY" >/dev/null 2>&1 || { echo "python3 tidak ditemukan. Install dulu (mis. sudo apt install python3 python3-venv)."; exit 1; }

echo "==> Membuat virtualenv di .venv"
if [ ! -d .venv ]; then
  "$PY" -m venv .venv || { echo "Gagal membuat venv. Di Debian/Ubuntu jalankan: sudo apt install python3-venv"; exit 1; }
fi

# shellcheck disable=SC1091
source .venv/bin/activate

echo "==> Meng-install paket Python"
python -m pip install --upgrade pip >/dev/null
python -m pip install -r requirements.txt

echo "==> Meng-install browser Chromium (Playwright)"
if ! python -m playwright install chromium; then
  echo "Gagal. Di Linux coba: python -m playwright install --with-deps chromium (butuh sudo)"
  exit 1
fi

# Library sistem untuk Chromium (hanya Linux; abaikan jika tanpa sudo)
if [ "$(uname -s)" = "Linux" ] && [ "${WITH_DEPS:-0}" = "1" ]; then
  echo "==> Meng-install dependensi sistem (sudo)"
  sudo "$(command -v python)" -m playwright install-deps chromium
fi

chmod +x run.sh
echo
echo "Selesai. Langkah berikutnya:"
echo "  ./run.sh login                      # login Threads sekali (manual di browser)"
echo "  ./run.sh keyword \"kata kunci\" 15    # ambil postingan berdasar kata kunci"
echo "  ./run.sh serve                      # buka viewer di http://localhost:8000"
