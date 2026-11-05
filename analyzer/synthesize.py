"""Synthetic yard audio used to tune and demonstrate the bark detector.

The shapes are deliberately simple: a harmonic pulse with a fast attack and
an exponential decay for a bark, and longer or noisier signals for the
things that should not page you (a door, talking, rain, a horn).
"""

from __future__ import annotations

import numpy as np

from analyzer.bark import SR


def _tone(sr: int, freqs: list[tuple[float, float]], seconds: float) -> np.ndarray:
    count = int(sr * seconds)
    t = np.arange(count) / sr
    signal = np.zeros(count, dtype=np.float64)
    for freq, amp in freqs:
        signal += amp * np.sin(2 * np.pi * freq * t)
    return signal


def bark_pulse(sr: int = SR, f0: float = 320.0, seconds: float = 0.18, amp: float = 0.8) -> np.ndarray:
    count = max(1, int(sr * seconds))
    t = np.arange(count) / sr
    attack = np.minimum(1.0, t / 0.012)
    decay = np.exp(-t / 0.055)
    harmonics = [(1, 1.0), (2, 0.62), (3, 0.38), (4, 0.22), (5, 0.12), (6, 0.06)]
    signal = _tone(sr, [(f0 * k, a) for k, a in harmonics], seconds)
    onset = np.random.default_rng(int(f0 * 10) % 10_000).standard_normal(count)
    signal = signal + 0.18 * onset * np.exp(-t / 0.018)
    signal *= attack * decay
    peak = np.max(np.abs(signal)) + 1e-9
    return (amp * signal / peak).astype(np.float32)


def volley(
    sr: int = SR,
    f0: float = 320.0,
    count: int = 4,
    gap: float = 0.34,
    seconds: float = 0.17,
    amp: float = 0.75,
) -> np.ndarray:
    rng = np.random.default_rng(int(f0))
    parts: list[np.ndarray] = []
    for index in range(count):
        wobble = float(f0 * (1 + 0.04 * rng.standard_normal()))
        parts.append(bark_pulse(sr, max(120.0, wobble), seconds, amp))
        if index != count - 1:
            parts.append(np.zeros(int(sr * gap), dtype=np.float32))
    return np.concatenate(parts)


def howl(sr: int = SR, seconds: float = 1.5, f0: float = 340.0, amp: float = 0.55) -> np.ndarray:
    count = int(sr * seconds)
    t = np.arange(count) / sr
    freq = f0 + 70.0 * np.sin(2 * np.pi * 0.8 * t) + 25.0 * np.sin(2 * np.pi * 2.3 * t)
    phase = 2 * np.pi * np.cumsum(freq) / sr
    signal = np.sin(phase) + 0.45 * np.sin(2 * phase) + 0.22 * np.sin(3 * phase)
    envelope = np.minimum(1.0, t / 0.09) * np.minimum(1.0, (seconds - t) / 0.18)
    envelope *= 0.75 + 0.25 * np.sin(2 * np.pi * 3.1 * t)
    signal *= envelope
    peak = np.max(np.abs(signal)) + 1e-9
    return (amp * signal / peak).astype(np.float32)


def speech_like(sr: int = SR, syllables: int = 6, amp: float = 0.42) -> np.ndarray:
    """Held vowels. Level stays up well past the point a bark has died away."""
    parts: list[np.ndarray] = []
    for index in range(syllables):
        seconds = 0.28
        count = int(sr * seconds)
        t = np.arange(count) / sr
        f0 = 150.0 + 25.0 * np.sin(index * 0.9)
        vibrato = f0 * (1.0 + 0.015 * np.sin(2 * np.pi * 4.5 * t))
        phase = 2 * np.pi * np.cumsum(vibrato) / sr
        signal = (
            np.sin(phase)
            + 0.45 * np.sin(2 * phase)
            + 0.22 * np.sin(3 * phase)
            + 0.1 * np.sin(4 * phase)
        )
        attack = np.clip(t / 0.04, 0, 1)
        release = np.clip((seconds - t) / 0.05, 0, 1)
        signal = signal * attack * release
        peak = np.max(np.abs(signal)) + 1e-9
        parts.append((amp * signal / peak).astype(np.float32))
        parts.append(np.zeros(int(sr * 0.09), dtype=np.float32))
    return np.concatenate(parts)


def door_slam(sr: int = SR, amp: float = 0.9) -> np.ndarray:
    count = int(sr * 0.09)
    t = np.arange(count) / sr
    rng = np.random.default_rng(3)
    signal = rng.standard_normal(count) * np.exp(-t / 0.012)
    peak = np.max(np.abs(signal)) + 1e-9
    return (amp * signal / peak).astype(np.float32)


def knocks(sr: int = SR) -> np.ndarray:
    slam = door_slam(sr, 0.7)[: int(sr * 0.05)]
    gap = np.zeros(int(sr * 0.22), dtype=np.float32)
    return np.concatenate([slam, gap, slam * 0.8])


def rain(sr: int = SR, seconds: float = 4.0, amp: float = 0.12) -> np.ndarray:
    rng = np.random.default_rng(11)
    noise = rng.standard_normal(int(sr * seconds))
    kernel = np.ones(10) / 10
    filtered = np.convolve(noise, kernel, mode="same")
    peak = np.max(np.abs(filtered)) + 1e-9
    return (amp * filtered / peak).astype(np.float32)


def hum(sr: int = SR, seconds: float = 5.0, amp: float = 0.08) -> np.ndarray:
    t = np.arange(int(sr * seconds)) / sr
    signal = np.sin(2 * np.pi * 120 * t) + 0.3 * np.sin(2 * np.pi * 240 * t)
    return (amp * signal).astype(np.float32)


def horn(sr: int = SR, seconds: float = 1.2, amp: float = 0.5) -> np.ndarray:
    signal = _tone(sr, [(440, 1.0), (880, 0.3)], seconds)
    t = np.arange(signal.size) / sr
    envelope = np.clip(t / 0.03, 0, 1) * np.clip((seconds - t) / 0.04, 0, 1)
    signal = signal * envelope
    peak = np.max(np.abs(signal)) + 1e-9
    return (amp * signal / peak).astype(np.float32)


def muffled_bark(sr: int = SR) -> np.ndarray:
    """A single bark with a slower decay. Scores under the Balanced line."""
    seconds = 0.22
    count = int(sr * seconds)
    t = np.arange(count) / sr
    f0 = 480.0
    signal = np.sin(2 * np.pi * f0 * t) + 0.4 * np.sin(2 * np.pi * f0 * 2 * t)
    rng = np.random.default_rng(5)
    signal = signal + 0.85 * rng.standard_normal(count) * np.exp(-t / 0.03)
    envelope = np.minimum(1.0, t / 0.04) * np.exp(-t / 0.12)
    signal = signal * envelope
    peak = np.max(np.abs(signal)) + 1e-9
    return (0.28 * signal / peak).astype(np.float32)


def chirps(sr: int = SR, amp: float = 0.35) -> np.ndarray:
    seconds = 0.14
    count = int(sr * seconds)
    t = np.arange(count) / sr
    freq = np.linspace(3400, 5200, count)
    phase = 2 * np.pi * np.cumsum(freq) / sr
    envelope = np.sin(np.linspace(0, np.pi, count)) ** 2
    chirp = (amp * envelope * np.sin(phase)).astype(np.float32)
    gap = np.zeros(int(sr * 0.12), dtype=np.float32)
    return np.concatenate([chirp, gap, chirp * 0.85])


def _place(buffer: np.ndarray, sr: int, at: float, sound: np.ndarray) -> None:
    start = int(at * sr)
    end = min(buffer.size, start + sound.size)
    if start >= buffer.size or end <= start:
        return
    buffer[start:end] += sound[: end - start]


def backyard(sr: int = SR) -> tuple[np.ndarray, list[dict]]:
    """Two minutes standing in for a morning on the backyard camera."""
    seconds = 120.0
    rng = np.random.default_rng(7)
    audio = (0.012 * rng.standard_normal(int(sr * seconds))).astype(np.float32)
    events = [
        {"at": 8.0, "label": "large-dog volley", "expect": "bark", "sound": volley(sr, 260, 5, 0.36, 0.17, 0.78)},
        {"at": 28.0, "label": "door", "expect": "ignore", "sound": door_slam(sr)},
        {"at": 40.0, "label": "talking", "expect": "ignore", "sound": speech_like(sr)},
        {"at": 62.0, "label": "small-dog yips", "expect": "bark", "sound": volley(sr, 1150, 7, 0.2, 0.07, 0.62)},
        {"at": 85.0, "label": "rain", "expect": "ignore", "sound": rain(sr, 4.0)},
        {"at": 100.0, "label": "single bark", "expect": "bark", "sound": bark_pulse(sr, 340, 0.2, 0.84)},
        {"at": 112.0, "label": "bird", "expect": "ignore", "sound": chirps(sr)},
    ]
    for event in events:
        _place(audio, sr, event["at"], event["sound"])
    peak = float(np.max(np.abs(audio)))
    if peak > 0.98:
        audio *= 0.98 / peak
    return audio, events


def hallway(sr: int = SR) -> tuple[np.ndarray, list[dict]]:
    seconds = 90.0
    rng = np.random.default_rng(9)
    audio = (0.01 * rng.standard_normal(int(sr * seconds))).astype(np.float32)
    events = [
        {"at": 12.0, "label": "two barks", "expect": "bark", "sound": volley(sr, 420, 2, 0.42, 0.16, 0.7)},
        {"at": 35.0, "label": "hum", "expect": "ignore", "sound": hum(sr, 5.0)},
        {"at": 48.0, "label": "muffled bark", "expect": "bark", "sound": muffled_bark(sr)},
        {"at": 55.0, "label": "knocks", "expect": "ignore", "sound": knocks(sr)},
        {"at": 70.0, "label": "howl", "expect": "howl", "sound": howl(sr, 1.45, 310, 0.6)},
    ]
    for event in events:
        _place(audio, sr, event["at"], event["sound"])
    peak = float(np.max(np.abs(audio)))
    if peak > 0.98:
        audio *= 0.98 / peak
    return audio, events
