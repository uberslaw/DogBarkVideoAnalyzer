import { connection, NextResponse } from "next/server";

import { ensurePreview } from "@/lib/preview";
import { streamFile } from "@/lib/stream";
import { isInsideRoot, log, readLibrary } from "@/lib/store";

export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const start = Number(url.searchParams.get("start"));
  const end = Number(url.searchParams.get("end"));
  if (!id || !Number.isFinite(start) || !Number.isFinite(end)) {
    return NextResponse.json({ error: "Missing clip." }, { status: 400 });
  }
  if (end - start > 120 || start < 0) {
    return NextResponse.json({ error: "Clip is too long." }, { status: 400 });
  }
  const library = await readLibrary();
  const recording = library.recordings.find((item) => item.id === id);
  if (!recording || !isInsideRoot(recording.path, library.roots)) {
    return NextResponse.json({ error: "That recording isn't in the library." }, { status: 404 });
  }
  try {
    const file = await ensurePreview(recording, start, end);
    return streamFile(request, file, "video/mp4");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Couldn't prepare a browser clip.";
    log(`preview failed ${id}: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
