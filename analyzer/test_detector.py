"""Tune the detector against barks and the sounds that should stay quiet."""

from __future__ import annotations

import os
import subprocess
import tempfile
import unittest

import numpy as np

from analyzer.bark import analyze_audio, analyze_file
from analyzer.synthesize import backyard, hallway, bark_pulse, horn, volley


def _hit(episodes, at: float, window: float = 1.6) -> bool:
    return any(episode.start <= at + window and episode.end >= at - 0.25 for episode in episodes)


class DetectorTests(unittest.TestCase):
    def test_backyard_finds_barks_and_skips_the_house(self):
        audio, events = backyard()
        episodes = analyze_audio(audio)
        missed = []
        false = []
        for event in events:
            found = _hit(episodes, event["at"])
            if event["expect"] == "ignore":
                if found:
                    false.append(event["label"])
            elif not found:
                missed.append(event["label"])
        detail = _format(episodes)
        self.assertFalse(missed, f"missed {missed}\n{detail}")
        self.assertFalse(false, f"false hits {false}\n{detail}")
        yips = next(episode for episode in episodes if abs(episode.start - 62) < 2)
        self.assertGreaterEqual(yips.barks, 4)
        volley = next(episode for episode in episodes if abs(episode.start - 8) < 2)
        self.assertGreaterEqual(volley.barks, 3)

    def test_hallway_howl_and_pair(self):
        audio, events = hallway()
        episodes = analyze_audio(audio)
        missed = [event["label"] for event in events if event["expect"] != "ignore" and not _hit(episodes, event["at"])]
        false = [event["label"] for event in events if event["expect"] == "ignore" and _hit(episodes, event["at"])]
        detail = _format(episodes)
        self.assertFalse(missed, f"missed {missed}\n{detail}")
        self.assertFalse(false, f"false hits {false}\n{detail}")
        howls = [episode for episode in episodes if episode.kind == "howl"]
        self.assertTrue(howls, detail)
        muffled = next(episode for episode in episodes if abs(episode.start - 48) < 2)
        self.assertGreater(muffled.score, 0.6)
        self.assertLess(muffled.score, 0.8)

    def test_volley_across_a_chunk_boundary_is_one_episode(self):
        sr = 16000
        audio = (0.012 * np.random.default_rng(4).standard_normal(sr * 45)).astype(np.float32)
        sound = volley(sr, 300, 4, 0.32, 0.16, 0.75)
        at = 29.4
        start = int(at * sr)
        audio[start : start + sound.size] += sound
        episodes = analyze_audio(audio)
        hits = [episode for episode in episodes if _hit([episode], at, 2.0)]
        self.assertEqual(len(hits), 1, _format(episodes))
        self.assertGreaterEqual(hits[0].barks, 3)

    def test_horn_is_not_a_howl(self):
        sr = 16000
        audio = (0.01 * np.random.default_rng(1).standard_normal(sr * 6)).astype(np.float32)
        sound = horn()
        audio[sr : sr + sound.size] += sound
        episodes = analyze_audio(audio)
        self.assertFalse(episodes, _format(episodes))

    def test_distant_single_bark_still_scores(self):
        sr = 16000
        audio = (0.012 * np.random.default_rng(2).standard_normal(sr * 8)).astype(np.float32)
        sound = bark_pulse(sr, 300, 0.18, 0.11)
        audio[2 * sr : 2 * sr + sound.size] += sound
        episodes = analyze_audio(audio)
        self.assertTrue(_hit(episodes, 2.0), _format(episodes))

    def test_aac_roundtrip_keeps_the_volley(self):
        audio, _events = backyard()
        # A shorter excerpt around the large-dog volley, encoded like a camera mic.
        excerpt = audio[: 20 * 16000]
        with tempfile.TemporaryDirectory() as tmp:
            wav = os.path.join(tmp, "in.wav")
            mp4 = os.path.join(tmp, "cam.mp4")
            _write_wav(wav, excerpt)
            subprocess.check_call(
                [
                    "ffmpeg",
                    "-y",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-i",
                    wav,
                    "-c:a",
                    "aac",
                    "-b:a",
                    "64k",
                    mp4,
                ]
            )
            result = analyze_file(mp4)
        starts = [episode["start"] for episode in result["episodes"]]
        self.assertTrue(any(5 <= start <= 12 for start in starts), result["episodes"])
        self.assertFalse(any(start > 14 for start in starts), result["episodes"])


def _format(episodes) -> str:
    lines = []
    for episode in episodes:
        lines.append(
            f"{episode.kind} {episode.start:.2f}-{episode.end:.2f} score={episode.score:.2f} n={episode.barks}"
        )
        for pulse in episode.pulses:
            lines.append(
                f"   {pulse.kind} {pulse.start:.2f} score={pulse.score:.2f} "
                f"atk={pulse.attack_ms:.0f}ms dec={pulse.decay:.2f} harm={pulse.harm:.2f} "
                f"band={pulse.band:.2f} flat={pulse.flatness:.2f} snr={pulse.snr_db:.1f}"
            )
    return "\n".join(lines) or "(no episodes)"


def _write_wav(path: str, audio: np.ndarray, sr: int = 16000) -> None:
    import wave

    pcm = np.clip(audio, -1, 1)
    pcm = (pcm * 32767).astype(np.int16)
    with wave.open(path, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sr)
        handle.writeframes(pcm.tobytes())


if __name__ == "__main__":
    unittest.main()
