import { connection, NextResponse } from "next/server";

import { loadEpisodes, getRunner } from "@/lib/runner";
import { readLibrary } from "@/lib/store";

export async function GET() {
  await connection();
  const [library, episodes] = await Promise.all([readLibrary(), loadEpisodes()]);
  return NextResponse.json({
    roots: library.roots,
    frigateUrl: library.frigateUrl,
    frigatePulledAt: library.frigatePulledAt,
    frigateError: library.frigateError,
    recordings: library.recordings,
    episodes,
    job: getRunner().snapshot(),
  });
}
