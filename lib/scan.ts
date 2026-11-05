import { spawn } from "child_process";
import fs from "fs";
import path from "path";

import { inferClip, labelCamera } from "@/lib/infer";
import { recordingId, samplesDir, updateLibrary } from "@/lib/store";
import type { Recording } from "@/lib/types";

const VIDEO = /\.(mp4|mkv|mov|m4v|avi|webm)$/i;
const VIDEO_CAP = 1500;
const ENTRY_CAP = 20000;

type Probe = {
  durationSec: number;
  hasAudio: boolean;
  audioCodec: string | null;
  videoCodec: string | null;
};

export class ScanError extends Error {}

export function resolveRoot(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new ScanError("Enter the folder the cameras write to.");
  if (!path.isAbsolute(trimmed)) {
    throw new ScanError("Use a full path on this machine, such as /mnt/nas/reolink.");
  }
  let real: string;
  try {
    real = fs.realpathSync(trimmed);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new ScanError(
        "That folder isn't on this machine. Mount the NAS first, then paste the mount path.",
      );
    }
    if (code === "EACCES") {
      throw new ScanError("Barkline can't read that folder. Check the mount and permissions.");
    }
    throw new ScanError("Couldn't open that folder.");
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(real);
  } catch {
    throw new ScanError("Couldn't open that folder.");
  }
  if (!stat.isDirectory()) {
    throw new ScanError("That path is a file. Choose the folder that contains the videos.");
  }
  if (real === path.parse(real).root) {
    throw new ScanError("Point at the camera folder, not the whole disk.");
  }
  return real;
}

export async function collectVideos(root: string): Promise<{ files: string[]; truncated: boolean }> {
  const files: string[] = [];
  let entries = 0;
  let truncated = false;

  async function walk(directory: string) {
    if (truncated) return;
    let listing: fs.Dirent[];
    try {
      listing = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EACCES") {
        throw new ScanError("Barkline can't read a folder inside that path. Check permissions.");
      }
      throw error;
    }
    for (const entry of listing) {
      entries += 1;
      if (entries > ENTRY_CAP || files.length >= VIDEO_CAP) {
        truncated = true;
        return;
      }
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "node_modules" || entry.name === "data") continue;
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        let real: string;
        try {
          real = fs.realpathSync(full);
        } catch {
          continue;
        }
        const realRoot = fs.realpathSync(root);
        if (real !== realRoot && !real.startsWith(realRoot + path.sep)) continue;
        const stat = await fs.promises.stat(real).catch(() => null);
        if (!stat) continue;
        if (stat.isDirectory()) await walk(real);
        else if (VIDEO.test(entry.name)) files.push(real);
        continue;
      }
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && VIDEO.test(entry.name)) files.push(full);
    }
  }

  await walk(root);
  return { files, truncated };
}

function probe(file: string): Promise<Probe> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_type,codec_name",
        "-of",
        "json",
        file,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `ffprobe exited ${code}`));
        return;
      }
      const data = JSON.parse(stdout || "{}") as {
        format?: { duration?: string };
        streams?: Array<{ codec_type?: string; codec_name?: string }>;
      };
      const streams = data.streams ?? [];
      const audio = streams.find((stream) => stream.codec_type === "audio");
      const video = streams.find((stream) => stream.codec_type === "video");
      resolve({
        durationSec: Number(data.format?.duration ?? 0) || 0,
        hasAudio: Boolean(audio),
        audioCodec: audio?.codec_name ?? null,
        videoCodec: video?.codec_name ?? null,
      });
    });
  });
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export async function scanRoot(rootInput: string): Promise<{
  root: string;
  added: number;
  total: number;
  truncated: boolean;
}> {
  const root = resolveRoot(rootInput);
  const { files, truncated } = await collectVideos(root);
  const probed = await pool(files, 4, async (file) => {
    const stat = await fs.promises.stat(file);
    let meta: Probe | null = null;
    let error: string | null = null;
    try {
      meta = await probe(file);
    } catch (probeError) {
      error = probeError instanceof Error ? probeError.message : "Couldn't read this file";
    }
    return { file, stat, meta, error };
  });

  let added = 0;
  let sampleRoot = "";
  try {
    sampleRoot = fs.realpathSync(samplesDir);
  } catch {
    sampleRoot = "";
  }
  const library = await updateLibrary((current) => {
    if (!current.roots.includes(root)) current.roots.push(root);
    for (const item of probed) {
      const id = recordingId(item.file);
      const inferred = inferClip(item.file);
      const sample = Boolean(sampleRoot) && item.file.startsWith(sampleRoot + path.sep);
      const existing = current.recordings.find((recording) => recording.id === id);
      const unchanged =
        existing &&
        existing.sizeBytes === item.stat.size &&
        existing.mtimeMs === Math.round(item.stat.mtimeMs);
      if (existing && unchanged) {
        existing.path = item.file;
        existing.camera = inferred.camera;
        existing.startedAt = inferred.startedAt;
        continue;
      }
      const recording: Recording = {
        id,
        path: item.file,
        name: path.basename(item.file),
        camera: inferred.camera || labelCamera(path.basename(path.dirname(item.file))),
        startedAt: inferred.startedAt,
        durationSec: item.meta?.durationSec ?? existing?.durationSec ?? 0,
        sizeBytes: item.stat.size,
        mtimeMs: Math.round(item.stat.mtimeMs),
        hasAudio: item.meta?.hasAudio ?? false,
        audioCodec: item.meta?.audioCodec ?? null,
        videoCodec: item.meta?.videoCodec ?? null,
        sample,
        status: item.error ? "error" : item.meta?.hasAudio ? "ready" : "no-audio",
        progress: 0,
        error: item.error ?? (item.meta?.hasAudio ? null : "No microphone track in this file."),
        analyzedAt: null,
        episodeCount: 0,
        barkCount: 0,
        howlCount: 0,
      };
      if (existing) {
        const index = current.recordings.findIndex((itemRecording) => itemRecording.id === id);
        current.recordings[index] = recording;
      } else {
        current.recordings.push(recording);
        added += 1;
      }
    }
  });

  return { root, added, total: library.recordings.length, truncated };
}
