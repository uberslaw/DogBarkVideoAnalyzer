import { connection, NextResponse } from "next/server";

import { readLibrary } from "@/lib/store";

export async function GET(request: Request) {
  await connection();
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !/^[A-Za-z0-9._:-]+$/.test(id)) {
    return NextResponse.json({ error: "Missing Frigate event." }, { status: 400 });
  }
  const library = await readLibrary();
  if (!library.frigateUrl) {
    return NextResponse.json({ error: "Pull events from Frigate first." }, { status: 400 });
  }
  const upstream = `${library.frigateUrl}/api/events/${encodeURIComponent(id)}/clip.mp4`;
  try {
    const response = await fetch(upstream, { signal: AbortSignal.timeout(20000) });
    if (!response.ok || !response.body) {
      return NextResponse.json({ error: `Frigate returned ${response.status} for that clip.` }, { status: 502 });
    }
    return new Response(response.body, {
      headers: {
        "Content-Type": response.headers.get("content-type") ?? "video/mp4",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Couldn't fetch that clip from Frigate. Check that the event still has a recording." },
      { status: 502 },
    );
  }
}
