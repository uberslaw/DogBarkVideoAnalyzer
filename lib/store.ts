import { createHash } from "crypto";
import fs from "fs";
import path from "path";

import type { CacheFile, LibraryData, Recording } from "@/lib/types";

export const rootDir = process.cwd();
export const dataDir = path.join(rootDir, "data");
export const cacheDir = path.join(dataDir, "cache");
export const previewDir = path.join(dataDir, "previews");
export const logFile = path.join(dataDir, "logs", "barkline.log");
export const libraryFile = path.join(dataDir, "library.json");
export const samplesDir = path.join(rootDir, "samples");

const emptyLibrary = (): LibraryData => ({
  roots: [],
  frigateUrl: "",
  recordings: [],
  frigateEpisodes: [],
  frigatePulledAt: null,
  frigateError: null,
});

export function log(message: string) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`);
}

export function recordingId(filePath: string): string {
  const real = fs.realpathSync(filePath);
  return createHash("sha1").update(real).digest("hex").slice(0, 16);
}

export function cachePath(id: string): string {
  return path.join(cacheDir, `${id}.json`);
}

export async function readLibrary(): Promise<LibraryData> {
  try {
    const raw = await fs.promises.readFile(libraryFile, "utf8");
    const parsed = JSON.parse(raw) as LibraryData;
    return { ...emptyLibrary(), ...parsed, recordings: parsed.recordings ?? [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyLibrary();
    throw error;
  }
}

export async function writeLibrary(library: LibraryData): Promise<void> {
  await atomicWrite(libraryFile, library);
}

async function atomicWrite(file: string, data: unknown): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.promises.writeFile(temporary, JSON.stringify(data, null, 2));
  await fs.promises.rename(temporary, file);
}

export async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  await fs.promises.mkdir(dataDir, { recursive: true });
  const lock = path.join(dataDir, "write.lock");
  const started = Date.now();
  for (;;) {
    try {
      const handle = await fs.promises.open(lock, "wx");
      try {
        return await fn();
      } finally {
        await handle.close();
        await fs.promises.unlink(lock).catch(() => undefined);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      try {
        const stat = await fs.promises.stat(lock);
        if (Date.now() - stat.mtimeMs > 60_000) {
          await fs.promises.unlink(lock).catch(() => undefined);
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() - started > 20_000) {
        throw new Error("Timed out waiting to update Barkline's library.");
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }
}

export async function updateLibrary(mutate: (library: LibraryData) => void): Promise<LibraryData> {
  return withLock(async () => {
    const library = await readLibrary();
    mutate(library);
    await writeLibrary(library);
    return library;
  });
}

export async function readCache(id: string): Promise<CacheFile | null> {
  try {
    const raw = await fs.promises.readFile(cachePath(id), "utf8");
    return JSON.parse(raw) as CacheFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function cacheMatches(recording: Recording, cache: CacheFile | null): cache is CacheFile {
  return Boolean(
    cache &&
      cache.status === "done" &&
      cache.sizeBytes === recording.sizeBytes &&
      cache.mtimeMs === recording.mtimeMs,
  );
}

export function isInsideRoot(filePath: string, roots: string[]): boolean {
  let realFile: string;
  try {
    realFile = fs.realpathSync(filePath);
  } catch {
    return false;
  }
  const allowed = [...roots, samplesDir];
  return allowed.some((root) => {
    let realRoot: string;
    try {
      realRoot = fs.realpathSync(root);
    } catch {
      return false;
    }
    return realFile === realRoot || realFile.startsWith(realRoot + path.sep);
  });
}
