import { spawn } from "child_process";
import fs from "fs";
import path from "path";

import { logFile, rootDir } from "@/lib/store";
import type { Health } from "@/lib/types";

export function pythonBin(): string {
  const venv = path.join(rootDir, ".venv", "bin", "python");
  if (fs.existsSync(venv)) return venv;
  return "python3";
}

function commandExists(command: string): boolean {
  const paths = (process.env.PATH ?? "").split(path.delimiter);
  return paths.some((directory) => fs.existsSync(path.join(directory, command)));
}

function run(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: rootDir });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({ code: 1, stdout, stderr: `${stderr}\n${error.message}` });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export async function doctor(): Promise<Health> {
  const ffmpeg = commandExists("ffmpeg");
  const ffprobe = commandExists("ffprobe");
  const python = pythonBin();
  const numpy = await run(python, ["-c", "import numpy"]);
  const numpyOk = numpy.code === 0;
  let message = "";
  if (!ffmpeg || !ffprobe) {
    message = "ffmpeg is not installed, so Barkline can't read the microphone track. Install ffmpeg and start again.";
  } else if (!numpyOk) {
    message = "Python dependencies are missing. From the project folder run: npm run setup";
  }
  return {
    ok: ffmpeg && ffprobe && numpyOk,
    ffmpeg,
    ffprobe,
    python,
    numpy: numpyOk,
    message,
    logFile,
  };
}

export { run };
