import { NextResponse } from "next/server";
import { metadataResponse } from "@/lib/metadataProxy";
import { parseAirframe } from "@/lib/intelligence";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  { params }: { params: { hex: string } },
) {
  if (!/^[0-9a-f]{6}$/i.test(params.hex))
    return NextResponse.json(
      { airframe: null },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  return metadataResponse(
    "aircraft",
    params.hex.toLowerCase(),
    "airframe",
    parseAirframe,
  );
}
