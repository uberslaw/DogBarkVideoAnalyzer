export type Sensitivity = "sensitive" | "balanced" | "strict";

export type RecordingStatus = "ready" | "no-audio" | "queued" | "running" | "done" | "error";

export type Recording = {
  id: string;
  path: string;
  name: string;
  camera: string;
  startedAt: string | null;
  durationSec: number;
  sizeBytes: number;
  mtimeMs: number;
  hasAudio: boolean;
  audioCodec: string | null;
  videoCodec: string | null;
  sample: boolean;
  status: RecordingStatus;
  progress: number;
  error: string | null;
  analyzedAt: string | null;
  episodeCount: number;
  barkCount: number;
  howlCount: number;
};

export type Pulse = {
  start: number;
  end: number;
  score: number;
};

export type ReviewEpisode = {
  id: string;
  recordingId: string | null;
  camera: string;
  /** Naive camera clock, YYYY-MM-DDTHH:mm:ss, or null when the file name has no time. */
  startedAt: string | null;
  /** Already formatted for the screen. */
  wallClock: string;
  dayKey: string;
  start: number;
  end: number;
  score: number;
  kind: "bark" | "howl";
  barks: number;
  pulses: Pulse[];
  source: "recording" | "frigate";
  frigateEventId?: string;
  label?: string;
};

export type JobSnapshot = {
  status: "idle" | "running" | "done" | "error";
  total: number;
  finished: number;
  currentId: string | null;
  currentLabel: string | null;
  fileProgress: number;
  message: string;
};

export type LibraryData = {
  roots: string[];
  frigateUrl: string;
  recordings: Recording[];
  frigateEpisodes: ReviewEpisode[];
  frigatePulledAt: string | null;
  frigateError: string | null;
};

export type CacheFile = {
  id: string;
  status: "done" | "error";
  progress?: number;
  sizeBytes: number;
  mtimeMs: number;
  durationSec?: number;
  hasAudio?: boolean;
  audioCodec?: string | null;
  videoCodec?: string | null;
  error: string | null;
  episodes: Array<{
    start: number;
    end: number;
    score: number;
    kind: "bark" | "howl";
    barks: number;
    pulses: Array<Pulse & { kind?: string }>;
  }>;
};

export type Health = {
  ok: boolean;
  ffmpeg: boolean;
  ffprobe: boolean;
  python: string;
  numpy: boolean;
  message: string;
  logFile: string;
};
