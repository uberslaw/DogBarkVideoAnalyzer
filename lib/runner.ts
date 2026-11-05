import { spawn } from "child_process";
import fs from "fs";

import { episodesFromCache } from "@/lib/episodes";
import { pythonBin } from "@/lib/health";
import {
  cacheDir,
  cacheMatches,
  cachePath,
  log,
  readCache,
  readLibrary,
  updateLibrary,
} from "@/lib/store";
import type { JobSnapshot, Recording, ReviewEpisode } from "@/lib/types";

type Task = { id: string; force: boolean };

const globalStore = globalThis as unknown as { barklineRunner?: Runner };

export class Runner {
  private pumping = false;
  private pending: Task[] = [];
  private active = new Set<string>();
  private ready: Promise<void>;
  private job: JobSnapshot = {
    status: "idle",
    total: 0,
    finished: 0,
    currentId: null,
    currentLabel: null,
    fileProgress: 0,
    message: "",
  };

  constructor() {
    this.ready = this.reconcile();
  }

  snapshot(): JobSnapshot {
    return { ...this.job };
  }

  async enqueue(ids: string[] | "all", force: boolean): Promise<JobSnapshot> {
    await this.ready;
    const library = await readLibrary();
    const chosen =
      ids === "all"
        ? library.recordings.filter((recording) => recording.hasAudio).map((recording) => recording.id)
        : ids;
    let queued = 0;
    for (const id of chosen) {
      if (this.pending.some((task) => task.id === id) || this.active.has(id)) continue;
      const recording = library.recordings.find((item) => item.id === id);
      if (!recording || !recording.hasAudio) continue;
      if (!force && recording.status === "error") continue;
      if (!force && recording.status === "done") {
        const cache = await readCache(id);
        if (cacheMatches(recording, cache)) continue;
      }
      this.pending.push({ id, force });
      queued += 1;
    }
    if (queued === 0 && this.job.status !== "running") {
      log(`listen skipped; ${chosen.length} file(s) already current`);
      this.job = {
        ...this.job,
        status: "done",
        total: 0,
        finished: 0,
        currentId: null,
        currentLabel: null,
        fileProgress: 1,
        message: "Nothing new to listen to. Finished files were kept.",
      };
      return this.snapshot();
    }
    if (this.job.status !== "running") {
      this.job = {
        status: "running",
        total: queued,
        finished: 0,
        currentId: null,
        currentLabel: null,
        fileProgress: 0,
        message: "Starting.",
      };
    } else {
      this.job.total += queued;
    }
    void this.pump();
    return this.snapshot();
  }

  private async reconcile() {
    try {
      let changed = 0;
      await updateLibrary((library) => {
        for (const recording of library.recordings) {
          if (recording.status === "running" || recording.status === "queued") {
            recording.status = "error";
            recording.progress = 0;
            recording.error =
              "Analysis stopped because Barkline restarted. Run it again — finished files are kept.";
            changed += 1;
          }
        }
      });
      if (changed) log(`reconciled ${changed} interrupted recording(s)`);
    } catch (error) {
      log(`reconcile failed: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    this.job.status = "running";
    try {
      while (this.pending.length) {
        const task = this.pending.shift();
        if (!task) break;
        this.active.add(task.id);
        try {
          await this.runOne(task.id, task.force);
        } finally {
          this.active.delete(task.id);
          this.job.finished += 1;
        }
      }
      this.job.status = "done";
      this.job.currentId = null;
      this.job.currentLabel = null;
      this.job.fileProgress = 1;
      if (!this.job.message.startsWith("Nothing new")) {
        this.job.message = "Finished listening.";
      }
    } catch (error) {
      this.job.status = "error";
      this.job.message = error instanceof Error ? error.message : "Analysis failed.";
      log(`runner failed: ${this.job.message}`);
    } finally {
      this.pumping = false;
      if (this.pending.length) void this.pump();
    }
  }

  private async runOne(id: string, force: boolean) {
    const library = await readLibrary();
    const recording = library.recordings.find((item) => item.id === id);
    if (!recording) return;
    this.job.currentId = id;
    this.job.currentLabel = recording.camera;
    this.job.fileProgress = 0;
    this.job.message = `Listening to ${recording.camera}`;

    if (!recording.hasAudio) {
      await updateLibrary((current) => {
        const item = current.recordings.find((entry) => entry.id === id);
        if (!item) return;
        item.status = "no-audio";
        item.error = "No microphone track in this file.";
      });
      return;
    }

    if (!force) {
      const cache = await readCache(id);
      if (cacheMatches(recording, cache)) {
        await applyCache(id, cache);
        this.job.fileProgress = 1;
        log(`skipped unchanged ${recording.path}`);
        return;
      }
    } else {
      await fs.promises.rm(cachePath(id), { force: true });
    }

    await updateLibrary((current) => {
      const item = current.recordings.find((entry) => entry.id === id);
      if (!item) return;
      item.status = "running";
      item.progress = 0.01;
      item.error = null;
    });

    await fs.promises.mkdir(cacheDir, { recursive: true });
    const code = await this.spawnWorker(recording);
    const cache = await readCache(id);
    if (code !== 0 || !cache || cache.status === "error") {
      const message = cache?.error || `Analysis failed (${code}). See ${"data/logs/barkline.log"}.`;
      await updateLibrary((current) => {
        const item = current.recordings.find((entry) => entry.id === id);
        if (!item) return;
        item.status = "error";
        item.progress = 0;
        item.error = message;
      });
      log(`error ${recording.path}: ${message}`);
      return;
    }
    if (cache.error === "no-audio" || cache.hasAudio === false) {
      await updateLibrary((current) => {
        const item = current.recordings.find((entry) => entry.id === id);
        if (!item) return;
        item.status = "no-audio";
        item.hasAudio = false;
        item.progress = 1;
        item.error = "No microphone track in this file.";
      });
      return;
    }
    await applyCache(id, cache);
    this.job.fileProgress = 1;
    log(`analyzed ${recording.path} episodes=${cache.episodes?.length ?? 0}`);
  }

  private spawnWorker(recording: Recording): Promise<number> {
    return new Promise((resolve) => {
      const child = spawn(
        pythonBin(),
        [
          "-m",
          "analyzer.worker",
          "--file",
          recording.path,
          "--out",
          cachePath(recording.id),
          "--id",
          recording.id,
          "--size",
          String(recording.sizeBytes),
          "--mtime",
          String(recording.mtimeMs),
        ],
        { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
      );
      let buffer = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("PROGRESS ")) continue;
          const value = Number(line.slice("PROGRESS ".length));
          if (!Number.isFinite(value)) continue;
          this.job.fileProgress = value;
          void updateLibrary((current) => {
            const item = current.recordings.find((entry) => entry.id === recording.id);
            if (!item || item.status !== "running") return;
            item.progress = value;
          }).catch((error) => {
            log(`progress write failed: ${error instanceof Error ? error.message : "unknown"}`);
          });
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
        if (stderr.length > 4000) stderr = stderr.slice(-4000);
      });
      child.on("error", (error) => {
        log(`worker spawn failed: ${error.message}`);
        void updateLibrary((current) => {
          const item = current.recordings.find((entry) => entry.id === recording.id);
          if (!item) return;
          item.status = "error";
          item.error = "Python environment is missing. From the project folder run: npm run setup";
        });
        resolve(1);
      });
      child.on("close", (code) => {
        if (stderr.trim()) log(`worker stderr ${recording.name}: ${stderr.trim()}`);
        resolve(code ?? 1);
      });
    });
  }
}

async function applyCache(id: string, cache: NonNullable<Awaited<ReturnType<typeof readCache>>>) {
  const episodes = cache.episodes ?? [];
  await updateLibrary((current) => {
    const item = current.recordings.find((entry) => entry.id === id);
    if (!item) return;
    item.status = "done";
    item.progress = 1;
    item.error = null;
    item.analyzedAt = new Date().toISOString();
    item.episodeCount = episodes.length;
    item.barkCount = episodes.reduce((sum, episode) => sum + (episode.barks ?? 0), 0);
    item.howlCount = episodes.filter((episode) => episode.kind === "howl").length;
    if (cache.durationSec) item.durationSec = cache.durationSec;
    if (cache.audioCodec) item.audioCodec = cache.audioCodec;
    if (cache.videoCodec) item.videoCodec = cache.videoCodec;
  });
}

export function getRunner(): Runner {
  if (!globalStore.barklineRunner) globalStore.barklineRunner = new Runner();
  return globalStore.barklineRunner;
}

export async function loadEpisodes(): Promise<ReviewEpisode[]> {
  const library = await readLibrary();
  const groups = await Promise.all(
    library.recordings.map(async (recording) => {
      if (recording.status !== "done") return [];
      const cache = await readCache(recording.id);
      if (!cacheMatches(recording, cache)) return [];
      return episodesFromCache(recording, cache);
    }),
  );
  return [...groups.flat(), ...library.frigateEpisodes];
}
