import { NextResponse } from "next/server";
import { getJobs } from "@/modules/careers/data";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ jobs: await getJobs() });
}
