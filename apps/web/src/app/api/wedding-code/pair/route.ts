import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Pairing is code-hard-disabled. The former response UUID and plaintext `ct`
 * were bearer capabilities without expiry/revocation, and historical QA
 * artifacts exposed both. Re-enable only with a server-generated secret,
 * digest-at-rest, expiry, revocation, and a reviewed anonymous-data contract.
 */
export async function POST() {
  return NextResponse.json(
    { error: "커플 비교 기능을 안전 점검 중입니다.", pairingStatus: "disabled" },
    { status: 410, headers: { "Cache-Control": "no-store" } }
  );
}
