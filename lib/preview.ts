import { spawn } from "child_process";
import fs from "fs";
import path from "path";

import { previewDir } from "@/lib/store";
import type { Recording } from "@/lib/types";

export async function ensurePreview(recording: Recording, start: number, end: number): Promise<string> {
  const clipStart = Math.max(0, start);
  const length = Math.min(90, Math.max(4, end - clipStart));
  const file = path.join(
    previewDir,
    `${recording.id}-${clipStart.toFixed(1)}-${length.toFixed(1)}.mp4`,
  );
  if (fs.existsSync(file) && fs.statSync(file).size > 800) return file;
  await fs.promises.mkdir(previewDir, { recursive: true });
  const temporary = `${file}.part.mp4`;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        clipStart.toFixed(3),
        "-i",
        recording.path,
        "-t",
        length.toFixed(3),
        "-vf",
        "scale='min(1280,iw)':-2",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "96k",
        "-movflags",
        "+faststart",
        temporary,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `ffmpeg exited ${code}`));
    });
  });
  await fs.promises.rename(temporary, file);
  return file;
}
