#!/usr/bin/env bash
# Install semua kebutuhan Threads SNA dari awal sampai siap dipakai:
#   1. Cek prasyarat (python3, Node.js 20+, npm)
#   2. Virtualenv .venv + paket Python (requirements.txt)
#   3. Sentimen lokal IndoBERT (opsional, ditanyakan saat instalasi)
#   4. Browser Chromium untuk Playwright (+ dependensi sistem opsional)
#   5. Dependensi Node/npm untuk dashboard React + Tailwind
#   6. Build aset produksi ke dist/
#   7. Template .env untuk analisis LLM (tidak menimpa kredensial yang ada)
#   8. Verifikasi instalasi lewat unit test (Python + Node)
#
# Opsi lewat environment:
#   PYTHON=python3.12   pilih interpreter Python
#   WITH_DEPS=1         install dependensi sistem Chromium (butuh sudo, Linux)
#   SKIP_BROWSER=1      lewati instalasi Chromium (mis. sudah terpasang / CI)
#   SKIP_BUILD=1        lewati npm run build
#   SKIP_TESTS=1        lewati verifikasi test
#   WITH_INDOBERT=1     pasang engine sentimen lokal tanpa tanya (0 = lewati)
#   INDOBERT_DEVICE=cuda|cpu  paksa device; default: cuda bila GPU terdeteksi
#   TORCH_CUDA_INDEX=cu130    paksa index wheel CUDA PyTorch
set -euo pipefail
cd "$(dirname "$0")"

PY="${PYTHON:-python3}"
WITH_DEPS="${WITH_DEPS:-0}"
SKIP_BROWSER="${SKIP_BROWSER:-0}"
SKIP_BUILD="${SKIP_BUILD:-0}"
SKIP_TESTS="${SKIP_TESTS:-0}"
WITH_INDOBERT="${WITH_INDOBERT:-}"
INDOBERT_DEVICE="${INDOBERT_DEVICE:-}"
TORCH_CUDA_INDEX="${TORCH_CUDA_INDEX:-}"
WANT_DEVICE=""

fail() { echo "ERROR: $*" >&2; exit 1; }

# Tanya ya/tidak. Non-interaktif (CI, curl|bash) memakai nilai default.
ask_yes_no() {
  local prompt="$1" default="$2" reply=""
  if [ ! -t 0 ]; then
    echo "$default"
    return 0
  fi
  while true; do
    if [ "$default" = "y" ]; then
      printf '%s [Y/n] ' "$prompt" >&2
    else
      printf '%s [y/N] ' "$prompt" >&2
    fi
    read -r reply || reply=""
    reply="${reply:-$default}"
    case "$reply" in
      [yY]|[yY][aA][sS]|[yY][eE][sS]) echo "y"; return 0 ;;
      [nN]|[nN][oO]|[tT][iI][dD][aA][kK]) echo "n"; return 0 ;;
      *) echo "    Jawab y atau n." >&2 ;;
    esac
  done
}

# Deteksi GPU dan pilih index wheel CUDA yang cocok dengan driver.
# Aturan: major harus sama, minor index <= minor driver (minor version compat).
detect_cuda_index() {
  command -v nvidia-smi >/dev/null 2>&1 || return 1
  local ver major minor idx imaj imin
  # Driver baru menulis "CUDA UMD Version: 13.4", yang lama "CUDA Version: 12.4".
  ver="$(nvidia-smi 2>/dev/null | sed -n 's/.*CUDA \(UMD \)\{0,1\}Version: \([0-9]*\.[0-9]*\).*/\2/p' | head -1)"
  [ -n "$ver" ] || return 1
  major="${ver%%.*}"
  minor="${ver##*.}"
  for idx in 130 129 128 126 124 121; do
    imaj=$((idx / 10))
    imin=$((idx % 10))
    if [ "$imaj" -eq "$major" ] && [ "$imin" -le "$minor" ]; then
      echo "cu${idx}"
      return 0
    fi
  done
  return 1
}

# True bila torch terpasang dan (untuk cuda) benar-benar melihat GPU.
have_torch_for() {
  WANT="$1" python -c "
import os, sys
try:
    import torch
except Exception:
    sys.exit(1)
if os.environ['WANT'] == 'cuda' and not torch.cuda.is_available():
    sys.exit(1)
" 2>/dev/null
}

# Set kunci di .env tanpa menimpa kunci lain.
set_env_key() {
  local key="$1" val="$2" file="${3:-.env}"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    sed -i.bak "s|^${key}=.*|${key}=${val}|" "$file" && rm -f "${file}.bak"
  else
    echo "${key}=${val}" >> "$file"
  fi
}

echo "==> [1/8] Cek prasyarat"
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

echo "==> [2/8] Membuat virtualenv di .venv dan memasang paket Python"
if [ ! -d .venv ]; then
  "$PY" -m venv .venv \
    || fail "Gagal membuat venv. Di Debian/Ubuntu jalankan: sudo apt install python3-venv"
fi
# shellcheck disable=SC1091
source .venv/bin/activate
python -m pip install --upgrade pip >/dev/null
python -m pip install -r requirements.txt

echo "==> [3/8] Engine sentimen lokal IndoBERT (opsional)"
if [ "$WITH_INDOBERT" = "0" ]; then
  echo "    Dilewati (WITH_INDOBERT=0)."
  INDOBERT_ON="0"
elif [ "$WITH_INDOBERT" = "1" ]; then
  echo "    Dipasang tanpa tanya (WITH_INDOBERT=1)."
  INDOBERT_ON="1"
else
  echo "    IndoBERT melabeli sentimen sepenuhnya offline (tanpa API LLM),"
  echo "    tapi hanya 3 kelas: positif/negatif/netral. Emosi, toksisitas,"
  echo "    spam, dan topik tetap butuh LLM API."
  echo "    Ukuran unduhan: ~2,5 GB (torch) + ~500 MB (bobot model)."
  INDOBERT_ON="$(ask_yes_no "    Pasang IndoBERT sekarang?" "n")"
fi

if [ "$INDOBERT_ON" = "1" ]; then
  WANT_DEVICE="${INDOBERT_DEVICE:-}"
  if [ -z "$WANT_DEVICE" ]; then
    if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
      WANT_DEVICE="cuda"
      echo "    GPU terdeteksi: $(nvidia-smi --query-gpu=name --format=csv,noheader | head -1)"
    else
      WANT_DEVICE="cpu"
      echo "    Tidak ada GPU terdeteksi; memakai CPU."
    fi
  fi

  if [ "$WANT_DEVICE" = "cuda" ]; then
    IDX="${TORCH_CUDA_INDEX:-}"
    if [ -z "$IDX" ]; then
      IDX="$(detect_cuda_index || true)"
      if [ -z "$IDX" ]; then
        echo "    Peringatan: versi CUDA driver tidak terbaca; memakai cu130."
        IDX="cu130"
      fi
    fi
    echo "    Memasang torch build CUDA ($IDX) — unduhan besar, mohon tunggu…"
    if ! python -m pip install --index-url "https://download.pytorch.org/whl/${IDX}" torch; then
      echo "    Gagal memasang torch CUDA; mencoba build CPU sebagai gantinya." >&2
      WANT_DEVICE="cpu"
    fi
  fi

  if [ "$WANT_DEVICE" = "cpu" ]; then
    echo "    Memasang torch build CPU…"
    python -m pip install torch \
      || fail "Gagal memasang torch. Periksa koneksi ke PyPI."
  fi

  python -m pip install transformers sentencepiece \
    || fail "Gagal memasang transformers/sentencepiece."

  echo "    Memverifikasi torch…"
  if have_torch_for "$WANT_DEVICE"; then
    python - <<'PY'
import torch
print("    torch %s · cuda tersedia: %s" % (torch.__version__, torch.cuda.is_available()))
PY
  else
    echo "    Peringatan: torch terpasang tetapi device '$WANT_DEVICE' tidak siap." >&2
    echo "    Analisis IndoBERT akan jatuh ke CPU. Cek driver/CUDA bila ingin GPU." >&2
  fi

  # Pilihan disimpan dan ditulis ke .env di langkah 7 (setelah .env ada).
else
  echo "    Lewati. Bisa dipasang kapan saja nanti:"
  echo "      .venv/bin/pip install --index-url https://download.pytorch.org/whl/cu130 torch"
  echo "      .venv/bin/pip install transformers sentencepiece"
fi

echo "==> [4/8] Browser Chromium untuk Playwright"
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

echo "==> [5/8] Dependensi Node (React, D3, Vite, Tailwind)"
if [ -d node_modules ] && npm ls --depth=0 >/dev/null 2>&1; then
  echo "    node_modules sudah valid; lewati npm install."
elif [ -f package-lock.json ]; then
  npm ci || fail "npm ci gagal. Coba hapus node_modules lalu jalankan ulang install.sh."
else
  npm install || fail "npm install gagal. Periksa koneksi ke registry npm."
fi

echo "==> [6/8] Build dashboard React + Tailwind ke dist/"
if [ "$SKIP_BUILD" = "1" ]; then
  echo "    Dilewati (SKIP_BUILD=1)."
else
  npm run build || fail "Gagal membangun dashboard. Periksa src/ lalu jalankan npm run build."
fi

echo "==> [7/8] Menyiapkan .env untuk analisis LLM"
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

# Terapkan pilihan IndoBERT dari langkah 3 ke .env (tanpa menimpa kunci lain).
if [ "$INDOBERT_ON" = "1" ] && [ -n "${WANT_DEVICE:-}" ]; then
  set_env_key "SENTIMENT_ENGINE" "indobert"
  set_env_key "INDOBERT_DEVICE" "$WANT_DEVICE"
  echo "    .env: SENTIMENT_ENGINE=indobert, INDOBERT_DEVICE=$WANT_DEVICE"
fi

echo "==> [8/8] Verifikasi instalasi (unit test Python + Node)"
chmod +x run.sh install.sh
if [ "$SKIP_TESTS" = "1" ]; then
  echo "    Dilewati (SKIP_TESTS=1)."
else
  ./run.sh test || fail "Unit test gagal. Periksa output di atas."
fi

echo
if [ "$INDOBERT_ON" = "1" ]; then
  echo "Selesai. Engine sentimen: IndoBERT lokal (device=$WANT_DEVICE) — tanpa API."
else
  echo "Selesai. Engine sentimen: LLM API (butuh LLM_API_KEY di .env)."
fi
echo "Langkah berikutnya:"
echo "  1. Isi LLM_API_KEY di .env bila ingin analisis sentimen lewat API (opsional)."
echo "  2. ./run.sh login                       # login Threads sekali (manual di browser)"
echo "  3. ./run.sh keyword \"kata kunci\" 15     # ambil postingan berdasar kata kunci"
echo "  4. ./run.sh serve                       # http://localhost:8000/viewer.html"
echo "                                          # http://localhost:8000/sentimen.html"
echo "  5. ./run.sh analyze                     # opsional: hasilkan llm_analysis.json"
if [ "$INDOBERT_ON" = "1" ]; then
  echo "     ./run.sh analyze --engine indobert   # pelabelan lokal di $WANT_DEVICE"
fi
echo
echo "Perintah lain: ./run.sh build (build ulang UI), ./run.sh test (verifikasi ulang)."
