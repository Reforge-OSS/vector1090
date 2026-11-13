import { NextResponse } from "next/server";
import { metadataResponse } from "@/lib/metadataProxy";
import { parseFlightRoute } from "@/lib/intelligence";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  { params }: { params: { callsign: string } },
) {
  const callsign = params.callsign.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,10}$/.test(callsign))
    return NextResponse.json(
      { route: null },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  return metadataResponse("callsign", callsign, "route", parseFlightRoute);
}
