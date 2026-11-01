#!/usr/bin/env bash
# Install a local Python + Playwright Chromium for browser-use on Render/Node images
# that ship without system python3.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RT="$ROOT/.browser-use-runtime"
VENV="$RT/venv"
REQ="$ROOT/workers/requirements.txt"

mkdir -p "$RT"
export PATH="${HOME}/.local/bin:${PATH}"
# Keep browsers inside the project so Render's build slug includes them.
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$RT/ms-playwright}"
mkdir -p "$PLAYWRIGHT_BROWSERS_PATH"

need_install=0
if [[ ! -x "$VENV/bin/python" ]]; then
  need_install=1
elif ! "$VENV/bin/python" -c "import playwright" 2>/dev/null; then
  need_install=1
fi

if [[ "$need_install" -eq 1 ]]; then
  echo "[browser-use-runtime] installing into $RT"
  if ! command -v uv >/dev/null 2>&1; then
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="${HOME}/.local/bin:${PATH}"
  fi
  uv python install 3.12
  uv venv "$VENV" --python 3.12
  uv pip install -r "$REQ" --python "$VENV/bin/python"
fi

echo "[browser-use-runtime] ensuring Chromium under $PLAYWRIGHT_BROWSERS_PATH"
"$VENV/bin/python" -m playwright install chromium

PROBE_PY="$RT/_chrome_path_probe.py"
cat > "$PROBE_PY" <<'PY'
import os
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", os.environ.get("PLAYWRIGHT_BROWSERS_PATH", ""))
try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        print(p.chromium.executable_path)
except Exception:
    print("")
PY
CHROME_HINT="$(PLAYWRIGHT_BROWSERS_PATH="$PLAYWRIGHT_BROWSERS_PATH" "$VENV/bin/python" "$PROBE_PY" || true)"
rm -f "$PROBE_PY"

cat > "$RT/env.sh" <<EOF
export BROWSER_USE_PYTHON="$VENV/bin/python"
export PLAYWRIGHT_BROWSERS_PATH="$PLAYWRIGHT_BROWSERS_PATH"
export PATH="$VENV/bin:\$PATH"
EOF
if [[ -n "${CHROME_HINT:-}" && -x "$CHROME_HINT" ]]; then
  echo "export CHROME_PATH=\"$CHROME_HINT\"" >> "$RT/env.sh"
fi

echo "[browser-use-runtime] done"
"$VENV/bin/python" --version
"$VENV/bin/python" -c "from playwright.sync_api import sync_playwright; print('playwright ok')"

echo "[browser-use-runtime] chromium launch smoke"
if ! PLAYWRIGHT_BROWSERS_PATH="$PLAYWRIGHT_BROWSERS_PATH" "$VENV/bin/python" - <<'PY'
import os
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=True,
        args=["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
        timeout=30000,
    )
    page = browser.new_page()
    page.goto("about:blank", timeout=10000)
    browser.close()
print("chromium launch ok")
PY
then
  echo "[browser-use-runtime] warn: chromium launch smoke failed (continuing)"
fi
