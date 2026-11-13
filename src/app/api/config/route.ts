import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export async function GET() {
  return NextResponse.json(
    {
      allowClientLocalUrl: process.env.ALLOW_CLIENT_LOCAL_URL === "true",
      localUrlConfigured: Boolean(process.env.LOCAL_AIRCRAFT_URL),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
