#!/usr/bin/env bash
# Install semua kebutuhan Threads SNA dari awal sampai siap dipakai:
#   1. Cek prasyarat (python3, Node.js 20+, npm)
#   2. Virtualenv .venv + paket Python (requirements.txt)
#   3. Browser Chromium untuk Playwright (+ dependensi sistem opsional)
#   4. Dependensi Node/npm untuk dashboard React + Tailwind
#   5. Build aset produksi ke dist/
#   6. Template .env untuk analisis LLM (tidak menimpa kredensial yang ada)
#   7. Verifikasi instalasi lewat unit test (Python + Node)
#
# Opsi lewat environment:
#   PYTHON=python3.12   pilih interpreter Python
#   WITH_DEPS=1         install dependensi sistem Chromium (butuh sudo, Linux)
#   SKIP_BROWSER=1      lewati instalasi Chromium (mis. sudah terpasang / CI)
#   SKIP_BUILD=1        lewati npm run build
#   SKIP_TESTS=1        lewati verifikasi test
set -euo pipefail
cd "$(dirname "$0")"

PY="${PYTHON:-python3}"
WITH_DEPS="${WITH_DEPS:-0}"
SKIP_BROWSER="${SKIP_BROWSER:-0}"
SKIP_BUILD="${SKIP_BUILD:-0}"
SKIP_TESTS="${SKIP_TESTS:-0}"

fail() { echo "ERROR: $*" >&2; exit 1; }

echo "==> [1/7] Cek prasyarat"
command -v "$PY" >/dev/null 2>&1 \
  || fail "'$PY' tidak ditemukan. Install dulu, mis. sudo apt install python3 python3-venv."
command -v node >/dev/null 2>&1 \
  || fail "Node.js tidak ditemukan. Dashboard butuh Node.js 20+ (https://nodejs.org)."
command -v npm >/dev/null 2>&1 \
  || fail "npm tidak ditemukan. Biasanya ikut terpasang bersama Node.js."
NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
[ "$NODE_MAJOR" -ge 20 ] \
  || fail "Node.js v$(node -v) terlalu lama; butuh >= 20 (Vite 6 / Tailwind v4)."
echo "    Python: $($PY --version 2>&1) · Node: $(node -v) · npm: $(npm -v)"

echo "==> [2/7] Membuat virtualenv di .venv dan memasang paket Python"
if [ ! -d .venv ]; then
  "$PY" -m venv .venv \
    || fail "Gagal membuat venv. Di Debian/Ubuntu jalankan: sudo apt install python3-venv"
fi
# shellcheck disable=SC1091
source .venv/bin/activate
python -m pip install --upgrade pip >/dev/null
python -m pip install -r requirements.txt

echo "==> [3/7] Browser Chromium untuk Playwright"
if [ "$SKIP_BROWSER" = "1" ]; then
  echo "    Dilewati (SKIP_BROWSER=1)."
else
  if ! python -m playwright install chromium; then
    fail "Gagal meng-install Chromium. Di Linux coba: python -m playwright install --with-deps chromium (butuh sudo)"
  fi
  if [ "$(uname -s)" = "Linux" ] && [ "$WITH_DEPS" = "1" ]; then
    echo "==>     Meng-install dependensi sistem Chromium (sudo)"
    sudo "$(command -v python)" -m playwright install-deps chromium
  elif [ "$(uname -s)" = "Linux" ]; then
    echo "    Catatan: jika Chromium gagal jalan karena library sistem, ulangi dengan WITH_DEPS=1 ./install.sh"
  fi
fi

echo "==> [4/7] Dependensi Node (React, D3, Vite, Tailwind)"
if [ -d node_modules ] && npm ls --depth=0 >/dev/null 2>&1; then
  echo "    node_modules sudah valid; lewati npm install."
elif [ -f package-lock.json ]; then
  npm ci || fail "npm ci gagal. Coba hapus node_modules lalu jalankan ulang install.sh."
else
  npm install || fail "npm install gagal. Periksa koneksi ke registry npm."
fi

echo "==> [5/7] Build dashboard React + Tailwind ke dist/"
if [ "$SKIP_BUILD" = "1" ]; then
  echo "    Dilewati (SKIP_BUILD=1)."
else
  npm run build || fail "Gagal membangun dashboard. Periksa src/ lalu jalankan npm run build."
fi

echo "==> [6/7] Menyiapkan .env untuk analisis LLM"
if [ -f .env ]; then
  echo "    .env sudah ada; tidak ditimpa."
  # Tambahkan kunci discovery baru bila belum ada (aman, tidak menimpa nilai lama).
  for kv in \
    "SCRAPE_DISCOVERY_WAIT_MS=5000" \
    "SCRAPE_DISCOVERY_STALL=4" \
    "SCRAPE_DISCOVERY_ROUNDS_EXTRA=20" \
    "SCRAPE_SCROLL_WAIT_MIN_MS=1200" \
    "SCRAPE_SCROLL_WAIT_MAX_MS=2200"; do
    key="${kv%%=*}"
    if ! grep -q "^${key}=" .env; then
      echo "$kv" >> .env
      echo "    Menambahkan $key ke .env"
    fi
  done
else
  cp .env.example .env
  echo "    .env dibuat dari .env.example — isi LLM_API_KEY dengan kredensial Anda."
fi

echo "==> [7/7] Verifikasi instalasi (unit test Python + Node)"
chmod +x run.sh install.sh
if [ "$SKIP_TESTS" = "1" ]; then
  echo "    Dilewati (SKIP_TESTS=1)."
else
  ./run.sh test || fail "Unit test gagal. Periksa output di atas."
fi

echo
echo "Selesai. Langkah berikutnya:"
echo "  1. Isi LLM_API_KEY di .env bila ingin analisis sentimen (opsional)."
echo "  2. ./run.sh login                       # login Threads sekali (manual di browser)"
echo "  3. ./run.sh keyword \"kata kunci\" 15     # ambil postingan berdasar kata kunci"
echo "  4. ./run.sh serve                       # http://localhost:8000/viewer.html"
echo "                                          # http://localhost:8000/sentimen.html"
echo "  5. ./run.sh analyze                     # opsional: hasilkan llm_analysis.json"
echo
echo "Perintah lain: ./run.sh build (build ulang UI), ./run.sh test (verifikasi ulang)."
