import { NextResponse } from "next/server";
import { getSummary } from "@/lib/summary";

export async function GET() {
  const summary = await getSummary();
  return NextResponse.json(summary);
}
