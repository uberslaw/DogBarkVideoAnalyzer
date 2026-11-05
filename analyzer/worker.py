"""Analyze one recording and write a cache file Barkline's server can read."""

from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
from pathlib import Path

from analyzer.bark import analyze_file


def _atomic(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload))
    os.replace(temporary, path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--id", required=True)
    parser.add_argument("--size", type=int, required=True)
    parser.add_argument("--mtime", type=int, required=True)
    args = parser.parse_args()
    out = Path(args.out)

    def on_progress(fraction: float) -> None:
        print(f"PROGRESS {fraction:.4f}", flush=True)

    try:
        result = analyze_file(args.file, on_progress=on_progress)
        payload = {
            "id": args.id,
            "status": "done",
            "progress": 1,
            "sizeBytes": args.size,
            "mtimeMs": args.mtime,
            "durationSec": result.get("durationSec") or 0,
            "hasAudio": bool(result.get("hasAudio")),
            "audioCodec": result.get("audioCodec"),
            "videoCodec": result.get("videoCodec"),
            "error": "no-audio" if result.get("error") == "no-audio" else None,
            "episodes": result.get("episodes") or [],
        }
        _atomic(out, payload)
        print("DONE", flush=True)
        return 0
    except Exception as error:  # noqa: BLE001 — the message is the operator-facing log
        traceback.print_exc(file=sys.stderr)
        _atomic(
            out,
            {
                "id": args.id,
                "status": "error",
                "progress": 0,
                "sizeBytes": args.size,
                "mtimeMs": args.mtime,
                "error": str(error).strip() or "Analysis failed",
                "episodes": [],
            },
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
