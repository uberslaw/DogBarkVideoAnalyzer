import { NextResponse } from "next/server";

import { doctor, pythonBin, run } from "@/lib/health";
import { getRunner } from "@/lib/runner";
import { scanRoot } from "@/lib/scan";
import { readLibrary, samplesDir } from "@/lib/store";

export async function POST() {
  const health = await doctor();
  if (!health.ok) return NextResponse.json({ error: health.message }, { status: 500 });
  const built = await run(pythonBin(), ["-m", "analyzer.sample_media"]);
  if (built.code !== 0) {
    return NextResponse.json(
      { error: built.stderr.trim() || "Couldn't build the sample afternoon." },
      { status: 500 },
    );
  }
  const scan = await scanRoot(samplesDir);
  const library = await readLibrary();
  const ids = library.recordings.filter((recording) => recording.sample && recording.hasAudio).map((recording) => recording.id);
  const job = await getRunner().enqueue(ids, false);
  return NextResponse.json({ scan, job });
}
