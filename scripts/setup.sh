#!/usr/bin/env bash
# Prepare a machine to run Barkline. Exits non-zero with a plain message if a tool is missing.
set -euo pipefail

cd "$(dirname "$0")/.."

missing() {
  echo "Missing $1. $2" >&2
  exit 1
}

command -v python3 >/dev/null 2>&1 || missing python3 "Install Python 3.11 or newer."
command -v ffmpeg >/dev/null 2>&1 || missing ffmpeg "Install ffmpeg. It includes ffprobe, which Barkline uses to read recordings."
command -v ffprobe >/dev/null 2>&1 || missing ffprobe "Install ffmpeg. ffprobe ships with it."
command -v node >/dev/null 2>&1 || missing node "Install Node.js 20 or newer."

if ! python3 -c "import ensurepip" >/dev/null 2>&1; then
  echo "python3-venv is not installed. On Debian or Ubuntu: sudo apt install python3-venv" >&2
  exit 1
fi

python3 -m venv .venv
.venv/bin/pip install -q -r analyzer/requirements.txt
mkdir -p data/logs
.venv/bin/python -m analyzer.doctor | tee data/logs/doctor.json
test -x .venv/bin/python
grep -q '"ok": true' data/logs/doctor.json
echo "Setup ok. Logs: data/logs/doctor.json"
echo "Start the reviewer with: npm run dev"
