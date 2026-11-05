"""Dog-bark burst detector for recorded camera audio.

A bark is a short harmonic pulse: fast attack, quick decay, most of its
energy between roughly 150 Hz and 2.8 kHz, usually fired in a volley.
A howl is the same kind of tone held and wavered for the better part of
a second.

The score ranks how much a moment matches that shape. It is not a
probability from Frigate's YAMNet model. Quiet dogs at the back fence and
odd household noises can still be missed or mistaken — use Sensitive when
you would rather hear a few extra clips than miss the dog.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass, field

import numpy as np

SR = 16000
FRAME = 400  # 25 ms
HOP = 160  # 10 ms
CHUNK_SECONDS = 30.0
OVERLAP_SECONDS = 2.0


@dataclass
class Pulse:
    start: float
    end: float
    score: float
    kind: str
    attack_ms: float
    decay: float
    harm: float
    band: float
    flatness: float
    snr_db: float
    peak_rms: float

    def to_dict(self) -> dict:
        return {
            "start": round(self.start, 3),
            "end": round(self.end, 3),
            "score": round(self.score, 3),
            "kind": self.kind,
            "attackMs": round(self.attack_ms, 1),
            "decay": round(self.decay, 3),
            "harm": round(self.harm, 3),
            "band": round(self.band, 3),
            "flatness": round(self.flatness, 3),
            "snrDb": round(self.snr_db, 1),
            "peakRms": round(float(self.peak_rms), 4),
        }


@dataclass
class Episode:
    start: float
    end: float
    score: float
    kind: str
    pulses: list[Pulse] = field(default_factory=list)

    @property
    def barks(self) -> int:
        return sum(1 for pulse in self.pulses if pulse.kind == "bark")

    def to_dict(self) -> dict:
        return {
            "start": round(self.start, 3),
            "end": round(self.end, 3),
            "score": round(self.score, 3),
            "kind": self.kind,
            "barks": self.barks,
            "pulses": [pulse.to_dict() for pulse in self.pulses],
        }


def _clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return lo if value < lo else hi if value > hi else value


def _features(samples: np.ndarray) -> dict[str, np.ndarray]:
    count = 1 + (len(samples) - FRAME) // HOP
    empty = np.zeros(0, dtype=np.float64)
    if count <= 0:
        return {"rms": empty, "band": empty, "flat": empty, "centroid": empty, "harm": empty}

    frames = np.lib.stride_tricks.as_strided(
        samples,
        shape=(count, FRAME),
        strides=(samples.strides[0] * HOP, samples.strides[0]),
    )
    window = np.hanning(FRAME).astype(np.float32)
    spectrum = np.fft.rfft(frames * window, axis=1)
    power = (spectrum.real.astype(np.float64) ** 2) + (spectrum.imag.astype(np.float64) ** 2)
    freqs = np.fft.rfftfreq(FRAME, 1.0 / SR)

    rms = np.sqrt(np.mean(frames.astype(np.float64) ** 2, axis=1) + 1e-12)

    def band_energy(lo: float, hi: float) -> np.ndarray:
        mask = (freqs >= lo) & (freqs < hi)
        return power[:, mask].sum(axis=1) + 1e-12

    band = band_energy(150, 2800) / band_energy(40, 7500)
    bark_bins = (freqs >= 150) & (freqs < 2800)
    bark_power = power[:, bark_bins] + 1e-12
    flatness = np.exp(np.mean(np.log(bark_power), axis=1)) / np.mean(bark_power, axis=1)
    bark_freqs = freqs[bark_bins]
    centroid = (bark_power * bark_freqs).sum(axis=1) / bark_power.sum(axis=1)

    autocorr = np.fft.irfft(power, n=FRAME, axis=1)
    autocorr /= autocorr[:, :1] + 1e-12
    # Lags covering about 120 Hz to 1.8 kHz at 16 kHz.
    harmonicity = np.clip(autocorr[:, 8:134].max(axis=1), 0.0, 1.0)

    return {
        "rms": rms,
        "band": band,
        "flat": flatness,
        "centroid": centroid,
        "harm": harmonicity,
    }


def _initial_noise(rms: np.ndarray) -> float:
    """Quietest short blocks in the opening moments, so a howl at the start is not the floor."""
    head = rms[: min(rms.size, 300)]
    if head.size == 0:
        return 1e-4
    block = 8
    if head.size < block * 2:
        return float(np.percentile(head, 20))
    mins = [
        float(np.min(head[index : index + block]))
        for index in range(0, head.size - block, block)
    ]
    return float(np.percentile(mins, 30))


def _noise_floor(rms: np.ndarray, seed: float | None) -> tuple[np.ndarray, float]:
    """Track the yard, not the dog. Loud frames do not pull the floor up."""
    if rms.size == 0:
        return rms, seed or 0.0
    noise = np.empty_like(rms)
    level = float(seed) if seed and seed > 0 else _initial_noise(rms)
    level = max(level, 1e-5)
    for index, value in enumerate(rms):
        if value <= level * 2.4:
            if value < level:
                level = 0.75 * level + 0.25 * float(value)
            else:
                level = 0.96 * level + 0.04 * float(value)
        noise[index] = level
    return noise, float(level)


def _attack_ms(rms: np.ndarray, noise: float, peak_index: int) -> float:
    peak = float(rms[peak_index])
    base = max(noise, peak * 0.12)
    span = peak - base
    if span <= 1e-6:
        return 80.0
    low = base + 0.2 * span
    high = base + 0.8 * span
    high_index = peak_index
    while high_index > 0 and rms[high_index] >= high:
        high_index -= 1
    low_index = high_index
    while low_index > 0 and rms[low_index] >= low:
        low_index -= 1
    return max(0.0, (high_index - low_index) * (HOP / SR) * 1000.0)


def _score_bark(
    attack_ms: float,
    decay: float,
    harm: float,
    band: float,
    flatness: float,
    dur_ms: float,
    snr_db: float,
) -> float:
    score = 0.0
    score += _clamp((harm - 0.22) / 0.45) * 0.22
    score += _clamp((band - 0.36) / 0.38) * 0.16
    score += _clamp((0.50 - flatness) / 0.34) * 0.12
    score += _clamp((50.0 - attack_ms) / 38.0) * 0.18
    score += _clamp((0.58 - decay) / 0.42) * 0.18
    score += _clamp((snr_db - 8.0) / 14.0) * 0.08
    if 50 <= dur_ms <= 380:
        score += 0.06
    elif dur_ms < 40 or dur_ms > 480:
        score -= 0.12
    # A bark has already fallen away 80 ms after the peak. Speech and horns have not.
    if decay > 0.68:
        score -= 0.36
    if attack_ms > 42:
        score -= 0.1
    return _clamp(score)


def _detect_howls(
    features: dict[str, np.ndarray],
    noise: np.ndarray,
    existing: list[Pulse],
) -> list[Pulse]:
    rms = features["rms"]
    count = len(rms)
    snr = rms / (noise + 1e-8)
    mask = (
        (snr >= 2.6)
        & (features["band"] >= 0.42)
        & (features["flat"] <= 0.38)
        & (features["harm"] >= 0.40)
        & (features["centroid"] >= 160)
        & (features["centroid"] <= 1600)
        & (rms >= 0.012)
    )
    hop_s = HOP / SR
    howls: list[Pulse] = []
    index = 0
    while index < count:
        if not mask[index]:
            index += 1
            continue
        end = index
        while end < count and mask[end]:
            end += 1
        dur_ms = (end - index) * hop_s * 1000.0
        if 700 <= dur_ms <= 4500:
            segment = rms[index:end]
            # Ignore the attack and release. A horn is flat in the middle; a howl wavers.
            left = max(1, int(segment.size * 0.15))
            right = max(left + 1, int(segment.size * 0.85))
            core = segment[left:right]
            variation = float(np.std(core) / (np.mean(core) + 1e-8))
            if variation >= 0.06:
                harm = float(np.median(features["harm"][index:end]))
                band = float(np.median(features["band"][index:end]))
                flatness = float(np.median(features["flat"][index:end]))
                peak_index = index + int(np.argmax(segment))
                peak = float(rms[peak_index])
                snr_db = float(20.0 * np.log10(peak / (float(noise[peak_index]) + 1e-8)))
                score = (
                    0.34 * harm
                    + 0.24 * min(band, 1.0)
                    + 0.2 * _clamp((0.42 - flatness) / 0.42)
                    + 0.22 * min(variation / 0.28, 1.0)
                )
                start_s = index * hop_s
                end_s = end * hop_s
                bark_overlap = sum(
                    1
                    for pulse in existing
                    if pulse.kind == "bark" and pulse.start < end_s and pulse.end > start_s
                )
                if bark_overlap < 2 and score >= 0.5:
                    howls.append(
                        Pulse(
                            start=start_s,
                            end=end_s,
                            score=float(min(score, 0.99)),
                            kind="howl",
                            attack_ms=0.0,
                            decay=variation,
                            harm=harm,
                            band=band,
                            flatness=flatness,
                            snr_db=snr_db,
                            peak_rms=peak,
                        )
                    )
        index = end
    return howls


def detect_pulses(samples: np.ndarray, noise_seed: float | None = None) -> tuple[list[Pulse], float]:
    audio = np.asarray(samples, dtype=np.float32)
    if audio.size < FRAME * 2:
        return [], noise_seed or 0.0
    audio = audio - float(np.mean(audio))
    features = _features(audio)
    rms = features["rms"]
    noise, seed = _noise_floor(rms, noise_seed)
    hop_s = HOP / SR
    snr = rms / (noise + 1e-8)
    candidate = (
        (snr >= 3.0)
        & (features["band"] >= 0.38)
        & (features["flat"] <= 0.52)
        & (features["harm"] >= 0.28)
        & (features["centroid"] >= 180)
        & (features["centroid"] <= 2600)
        & (rms >= 0.01)
    )

    pulses: list[Pulse] = []
    count = len(rms)
    index = 6
    while index < count - 2:
        recent_min = float(np.min(rms[index - 6 : index]))
        rising = rms[index] > recent_min * 1.7 and rms[index] > noise[index] * 2.8
        if candidate[index] and rising:
            window_end = min(count, index + 18)
            peak_index = index + int(np.argmax(rms[index:window_end]))
            peak = float(rms[peak_index])
            floor = max(float(noise[peak_index]) * 2.4, peak * 0.32)
            end = peak_index
            limit = min(count - 1, peak_index + 42)
            while end < limit and rms[end] > floor:
                end += 1
            start = max(0, index - 2)
            dur_ms = (end - start) * hop_s * 1000.0
            if 45 <= dur_ms <= 420:
                region = slice(start, max(end, start + 1))
                harm = float(np.median(features["harm"][region]))
                band = float(np.median(features["band"][region]))
                flatness = float(np.median(features["flat"][region]))
                attack = _attack_ms(rms, float(noise[peak_index]), peak_index)
                later = min(count - 1, peak_index + 8)
                decay = float(rms[later] / (peak + 1e-8))
                snr_db = float(20.0 * np.log10(peak / (float(noise[peak_index]) + 1e-8)))
                score = _score_bark(attack, decay, harm, band, flatness, dur_ms, snr_db)
                if score >= 0.36 and harm >= 0.26 and flatness <= 0.58:
                    pulses.append(
                        Pulse(
                            start=start * hop_s,
                            end=max(end, start + 1) * hop_s,
                            score=float(score),
                            kind="bark",
                            attack_ms=float(attack),
                            decay=decay,
                            harm=harm,
                            band=band,
                            flatness=flatness,
                            snr_db=snr_db,
                            peak_rms=peak,
                        )
                    )
            index = max(end, peak_index + 6)
            continue
        index += 1

    pulses.extend(_detect_howls(features, noise, pulses))
    return pulses, seed


def _dedupe(pulses: list[Pulse]) -> list[Pulse]:
    ordered = sorted(pulses, key=lambda pulse: (pulse.start, -pulse.score))
    kept: list[Pulse] = []
    for pulse in ordered:
        if kept and pulse.kind == kept[-1].kind and abs(pulse.start - kept[-1].start) < 0.12:
            if pulse.score > kept[-1].score:
                kept[-1] = pulse
            continue
        kept.append(pulse)
    return kept


def cluster_episodes(pulses: list[Pulse], gap: float = 1.7) -> list[Episode]:
    if not pulses:
        return []
    ordered = sorted(pulses, key=lambda pulse: pulse.start)
    groups: list[list[Pulse]] = [[ordered[0]]]
    for pulse in ordered[1:]:
        if pulse.start - groups[-1][-1].end <= gap:
            groups[-1].append(pulse)
        else:
            groups.append([pulse])

    episodes: list[Episode] = []
    for group in groups:
        barks = [pulse for pulse in group if pulse.kind == "bark"]
        howls = [pulse for pulse in group if pulse.kind == "howl"]
        chosen = barks if barks else howls
        if not chosen:
            continue
        if barks:
            span = max(pulse.end for pulse in barks) - min(pulse.start for pulse in barks)
            duty = sum(pulse.end - pulse.start for pulse in barks) / span if span > 0.2 else 1.0
            # Talking has little silence between syllables. A volley does.
            if len(barks) >= 4 and duty > 0.72:
                continue
        score = max(pulse.score for pulse in chosen)
        kind = "bark" if barks else "howl"
        keep = False
        if kind == "howl" and score >= 0.50:
            keep = True
        elif len(barks) >= 2 and score >= 0.40:
            keep = True
        elif len(barks) == 1 and score >= 0.56:
            keep = True
        if not keep:
            continue
        episodes.append(
            Episode(
                start=min(pulse.start for pulse in chosen),
                end=max(pulse.end for pulse in chosen),
                score=float(score),
                kind=kind,
                pulses=chosen,
            )
        )
    return episodes


def _detect_all(samples: np.ndarray) -> list[Pulse]:
    chunk = int(CHUNK_SECONDS * SR)
    overlap = int(OVERLAP_SECONDS * SR)
    if len(samples) <= chunk + overlap:
        found, _ = detect_pulses(samples)
        return found

    pulses: list[Pulse] = []
    seed: float | None = None
    pos = 0
    while pos < len(samples):
        end = min(len(samples), pos + chunk)
        start = max(0, pos - overlap) if pos else 0
        found, seed = detect_pulses(samples[start:end], seed)
        base = start / SR
        guard = (pos - start) / SR
        for pulse in found:
            if pos and pulse.start < guard - 0.05:
                continue
            pulse.start += base
            pulse.end += base
            pulses.append(pulse)
        if end >= len(samples):
            break
        pos = end
    return _dedupe(pulses)


def analyze_audio(samples: np.ndarray, sr: int = SR) -> list[Episode]:
    audio = np.asarray(samples, dtype=np.float32)
    if audio.ndim > 1:
        audio = np.mean(audio, axis=1).astype(np.float32)
    if sr != SR:
        duration = len(audio) / float(sr)
        target = int(duration * SR)
        if target < FRAME:
            return []
        source_t = np.linspace(0.0, duration, num=len(audio), endpoint=False)
        target_t = np.linspace(0.0, duration, num=target, endpoint=False)
        audio = np.interp(target_t, source_t, audio).astype(np.float32)
    return cluster_episodes(_detect_all(audio))


def probe(path: str) -> dict:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=codec_type,codec_name",
            "-of",
            "json",
            path,
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    stdout = result.stdout.decode(errors="replace").strip()
    stderr = result.stderr.decode(errors="replace").strip()
    if result.returncode != 0 or not stdout:
        detail = stderr or stdout or f"ffprobe exited {result.returncode}"
        raise RuntimeError(f"Couldn't read {path}: {detail}")
    try:
        data = json.loads(stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"ffprobe returned unexpected output for {path}: {stdout[:200]}") from error
    streams = data.get("streams") or []
    audio = next((stream for stream in streams if stream.get("codec_type") == "audio"), None)
    video = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
    duration = float((data.get("format") or {}).get("duration") or 0.0)
    return {
        "durationSec": duration,
        "hasAudio": audio is not None,
        "audioCodec": None if audio is None else audio.get("codec_name"),
        "videoCodec": None if video is None else video.get("codec_name"),
    }


def analyze_file(path: str, on_progress=None) -> dict:
    """Decode the microphone track in chunks so a 12-hour file stays off the heap."""
    meta = probe(path)
    if not meta["hasAudio"]:
        return {"episodes": [], "error": "no-audio", **meta}

    process = subprocess.Popen(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            path,
            "-vn",
            "-ac",
            "1",
            "-ar",
            str(SR),
            "-f",
            "s16le",
            "-acodec",
            "pcm_s16le",
            "pipe:1",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    assert process.stdout is not None
    chunk_bytes = int(CHUNK_SECONDS * SR) * 2
    overlap_samples = int(OVERLAP_SECONDS * SR)
    pending = np.zeros(0, dtype=np.float32)
    pulses: list[Pulse] = []
    seed: float | None = None
    read_samples = 0
    duration = float(meta["durationSec"] or 0.0)
    error_text = b""
    code = 0
    try:
        while True:
            blob = process.stdout.read(chunk_bytes)
            if not blob:
                break
            if len(blob) % 2:
                blob = blob[:-1]
            if not blob:
                break
            block = np.frombuffer(blob, dtype="<i2").astype(np.float32) / 32768.0
            read_samples += int(block.size)
            audio = block if pending.size == 0 else np.concatenate([pending, block])
            found, seed = detect_pulses(audio, seed)
            base = (read_samples - block.size - pending.size) / SR
            guard = pending.size / SR
            for pulse in found:
                if pending.size and pulse.start < guard - 0.08:
                    continue
                pulse.start += base
                pulse.end += base
                pulses.append(pulse)
            if on_progress and duration > 0:
                on_progress(min(0.99, (read_samples / SR) / duration))
            pending = audio[-overlap_samples:].copy() if audio.size > overlap_samples else audio.copy()
        if process.stderr is not None:
            error_text = process.stderr.read()
    finally:
        if process.stdout is not None:
            process.stdout.close()
        if process.stderr is not None:
            process.stderr.close()
        code = process.wait()
    episodes = cluster_episodes(_dedupe(pulses))
    if code != 0 and not episodes:
        message = error_text.decode(errors="replace").strip() or f"ffmpeg exited {code}"
        raise RuntimeError(message)
    if on_progress:
        on_progress(1.0)
    return {"episodes": [episode.to_dict() for episode in episodes], "error": None, **meta}
