import { connection, NextResponse } from "next/server";

import { streamFile, videoType } from "@/lib/stream";
import { isInsideRoot, readLibrary } from "@/lib/store";

export async function GET(request: Request) {
  await connection();
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing recording." }, { status: 400 });
  const library = await readLibrary();
  const recording = library.recordings.find((item) => item.id === id);
  if (!recording || !isInsideRoot(recording.path, library.roots)) {
    return NextResponse.json({ error: "That recording isn't in the library." }, { status: 404 });
  }
  return streamFile(request, recording.path, videoType(recording.path));
}
