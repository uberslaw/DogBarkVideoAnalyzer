"""Build the short sample afternoon used to try Barkline without a NAS mount."""

from __future__ import annotations

import json
import subprocess
import wave
from pathlib import Path

import numpy as np

from analyzer.synthesize import SR, backyard, hallway

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "samples"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def _write_wav(path: Path, audio: np.ndarray) -> None:
    pcm = np.clip(audio, -1, 1)
    pcm = (pcm * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(SR)
        handle.writeframes(pcm.tobytes())


def _draw(text: str, size: int, color: str, x: str, y: str, enable: str | None = None) -> str:
    safe = text.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")
    parts = [
        f"fontfile={FONT}",
        f"text='{safe}'",
        f"fontsize={size}",
        f"fontcolor={color}",
        f"x={x}",
        f"y={y}",
    ]
    if enable:
        parts.append(f"enable='{enable}'")
    return "drawtext=" + ":".join(parts)


def render(
    path: Path,
    audio: np.ndarray,
    *,
    camera: str,
    clock: str,
    color: str,
    notes: list[tuple[float, float, str]],
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    wav = path.with_suffix(".wav")
    _write_wav(wav, audio)
    duration = len(audio) / SR
    filters = [
        _draw(camera, 36, "0xF4EFE6", "32", "28"),
        _draw("Sample recording  ·  not your cameras", 18, "0xE5833A", "32", "76"),
        "drawtext="
        + ":".join(
            [
                f"fontfile={FONT}",
                f"timecode='{clock.replace(':', '\\:')}\\:00'",
                "r=8",
                "fontsize=28",
                "fontcolor=0xF4EFE6",
                "x=32",
                "y=h-56",
            ]
        ),
        "drawbox=x=32:y=140:w=896:h=8:color=0x2A2622",
        "drawbox=x='32+mod(t*70\\,860)':y=136:w=36:h=16:color=0xE5833A",
    ]
    for start, end, label in notes:
        filters.append(
            _draw(
                label,
                22,
                "0xF4EFE6",
                "32",
                "180",
                f"between(t\\,{start}\\,{end})",
            )
        )
    video = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        f"color=c={color}:s=960x540:r=8:d={duration:.3f}",
        "-i",
        str(wav),
        "-filter_complex",
        ",".join(filters),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-preset",
        "veryfast",
        "-crf",
        "30",
        "-c:a",
        "aac",
        "-b:a",
        "64k",
        "-shortest",
        "-movflags",
        "+faststart",
        str(path),
    ]
    subprocess.check_call(video)
    wav.unlink(missing_ok=True)


def expected_public(events: list[dict]) -> list[dict]:
    return [
        {"at": event["at"], "label": event["label"], "expect": event["expect"]}
        for event in events
    ]


def build(force: bool = False) -> dict:
    back_audio, back_events = backyard()
    hall_audio, hall_events = hallway()
    clips = [
        {
            "path": SAMPLES / "backyard" / "2026-11-03_10-00-00.mp4",
            "audio": back_audio,
            "camera": "Backyard",
            "clock": "10:00:00",
            "color": "0x1A2420",
            "notes": [
                (8, 11, "Large dog"),
                (28, 29.2, "Door"),
                (40, 42.4, "Talking"),
                (62, 64.2, "Small dog"),
                (85, 89, "Rain"),
                (100, 101.2, "Single bark"),
                (112, 113.2, "Bird"),
            ],
            "events": expected_public(back_events),
        },
        {
            "path": SAMPLES / "hallway" / "2026-11-03_10-01-30.mp4",
            "audio": hall_audio,
            "camera": "Hallway",
            "clock": "10:01:30",
            "color": "0x241C18",
            "notes": [
                (12, 13.4, "Two barks"),
                (35, 40, "Vent hum"),
                (48, 49.2, "Muffled bark"),
                (55, 56.2, "Knock"),
                (70, 71.6, "Howl"),
            ],
            "events": expected_public(hall_events),
        },
    ]
    written = []
    for clip in clips:
        if force or not clip["path"].exists():
            render(
                clip["path"],
                clip["audio"],
                camera=clip["camera"],
                clock=clip["clock"],
                color=clip["color"],
                notes=clip["notes"],
            )
        written.append(str(clip["path"].relative_to(ROOT)))
    manifest = {
        "description": "A short stand-in for a morning of RLC-810WA recordings.",
        "clips": [
            {
                "file": str(clip["path"].relative_to(SAMPLES)),
                "camera": clip["camera"],
                "clock": clip["clock"],
                "events": clip["events"],
            }
            for clip in clips
        ],
    }
    (SAMPLES / "expected.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return {"samples": written, "root": str(SAMPLES)}


if __name__ == "__main__":
    import sys

    print(json.dumps(build(force="--force" in sys.argv)))
