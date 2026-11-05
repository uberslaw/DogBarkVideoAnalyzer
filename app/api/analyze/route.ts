import { NextResponse } from "next/server";

import { doctor } from "@/lib/health";
import { getRunner } from "@/lib/runner";

export async function POST(request: Request) {
  const health = await doctor();
  if (!health.ok) return NextResponse.json({ error: health.message }, { status: 500 });
  const body = (await request.json().catch(() => null)) as {
    ids?: unknown;
    all?: boolean;
    force?: boolean;
  } | null;
  const force = Boolean(body?.force);
  if (body?.all) {
    const job = await getRunner().enqueue("all", force);
    return NextResponse.json({ job });
  }
  const ids = Array.isArray(body?.ids) ? body.ids.filter((id): id is string => typeof id === "string") : [];
  if (!ids.length) return NextResponse.json({ error: "Choose at least one recording." }, { status: 400 });
  const job = await getRunner().enqueue(ids, force);
  return NextResponse.json({ job });
}
