import assert from "node:assert/strict";
import test from "node:test";

import { inferClip } from "./infer.ts";
import { addSeconds, formatStamp } from "./time.ts";
import { episodeVisible } from "./sensitivity.ts";

test("reolink file names keep the camera and the clock", () => {
  const clip = inferClip("/share/Reolink/Backyard_00_20261103101422.mp4");
  assert.equal(clip.camera, "Backyard");
  assert.equal(clip.startedAt, "2026-11-03T10:14:22");
});

test("sample folders name the camera when the file is only a timestamp", () => {
  const clip = inferClip("/data/samples/backyard/2026-11-03_10-00-00.mp4");
  assert.equal(clip.camera, "Backyard");
  assert.equal(clip.startedAt, "2026-11-03T10:00:00");
});

test("frigate recording paths use the camera directory", () => {
  const clip = inferClip("/media/frigate/recordings/2026-11-03/10/hallway/05.30.mp4");
  assert.equal(clip.camera, "Hallway");
  assert.equal(clip.startedAt, "2026-11-03T10:05:30");
});

test("adding seconds does not apply a timezone", () => {
  assert.equal(addSeconds("2026-11-03T10:00:00", 8), "2026-11-03T10:00:08");
  assert.match(formatStamp("2026-11-03T10:00:08"), /Tue 3 Nov · 10:00:08/);
});

test("sensitivity hides the muffled bark and, on strict, the howl", () => {
  const clear = { source: "recording", kind: "bark", barks: 5, score: 0.97 };
  const muffled = { source: "recording", kind: "bark", barks: 1, score: 0.75 };
  const howl = { source: "recording", kind: "howl", barks: 0, score: 0.93 };
  const frigate = { source: "frigate", kind: "bark", barks: 1, score: 0.2 };
  assert.equal(episodeVisible(clear, "strict"), true);
  assert.equal(episodeVisible(muffled, "sensitive"), true);
  assert.equal(episodeVisible(muffled, "balanced"), false);
  assert.equal(episodeVisible(howl, "balanced"), true);
  assert.equal(episodeVisible(howl, "strict"), false);
  assert.equal(episodeVisible(frigate, "strict"), true);
});
