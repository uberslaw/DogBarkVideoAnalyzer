import { NextResponse } from "next/server";

import { doctor } from "@/lib/health";
import { ScanError, scanRoot } from "@/lib/scan";
import { log } from "@/lib/store";

export async function POST(request: Request) {
  const health = await doctor();
  if (!health.ok) return NextResponse.json({ error: health.message }, { status: 500 });
  const body = (await request.json().catch(() => null)) as { root?: string } | null;
  try {
    const result = await scanRoot(body?.root ?? "");
    log(`scan ${result.root} added=${result.added} total=${result.total} truncated=${result.truncated}`);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ScanError) return NextResponse.json({ error: error.message }, { status: 400 });
    const message = error instanceof Error ? error.message : "Scan failed";
    log(`scan failed: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
