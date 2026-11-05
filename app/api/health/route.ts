import { connection, NextResponse } from "next/server";

import { doctor } from "@/lib/health";

export async function GET() {
  await connection();
  return NextResponse.json(await doctor());
}
