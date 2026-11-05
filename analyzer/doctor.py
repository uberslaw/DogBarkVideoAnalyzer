"""Fail fast when Barkline's machine is missing ffmpeg or numpy."""

from __future__ import annotations

import json
import shutil
import sys


def main() -> int:
    numpy_ok = False
    numpy_version = None
    numpy_error = None
    try:
        import numpy

        numpy_ok = True
        numpy_version = numpy.__version__
    except Exception as error:  # noqa: BLE001
        numpy_error = str(error)

    report = {
        "python": sys.executable,
        "pythonVersion": sys.version.split()[0],
        "numpy": numpy_ok,
        "numpyVersion": numpy_version,
        "numpyError": numpy_error,
        "ffmpeg": shutil.which("ffmpeg"),
        "ffprobe": shutil.which("ffprobe"),
    }
    report["ok"] = bool(report["numpy"] and report["ffmpeg"] and report["ffprobe"])
    print(json.dumps(report, indent=2))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
