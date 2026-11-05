import { NextResponse } from "next/server";

import { FrigateError, pullFrigate } from "@/lib/frigate";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { url?: string; hours?: number } | null;
  try {
    const episodes = await pullFrigate(body?.url ?? "", Number(body?.hours ?? 12));
    return NextResponse.json({ count: episodes.length });
  } catch (error) {
    if (error instanceof FrigateError) return NextResponse.json({ error: error.message }, { status: 400 });
    const message = error instanceof Error ? error.message : "Frigate request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
