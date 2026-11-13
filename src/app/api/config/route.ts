import { NextResponse } from "next/server";
import { configuredReceiverUrl } from "@/lib/feedProxy";

export const dynamic = "force-dynamic";
export async function GET() {
  return NextResponse.json(
    {
      allowClientLocalUrl: process.env.ALLOW_CLIENT_LOCAL_URL === "true",
      localUrlConfigured: Boolean(configuredReceiverUrl()),
      localReceiverConfigured: Boolean(configuredReceiverUrl()),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
