import { isUuid } from "@/utils/requestValidation";

type SafetyHoldServiceClient = {
  rpc: (
    name: "seal_amora_mediation_private_safety_hold",
    args: { p_couple_id: string; p_recipient_user_id: string },
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

type SealMediationPrivateSafetyHoldInput = {
  client: SafetyHoldServiceClient;
  coupleId: string;
  recipientUserId: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isExactSealReceipt(
  value: unknown,
  coupleId: string,
  recipientUserId: string,
): boolean {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort().join(",");
  if (keys !== "active,coupleId,expiresAt,privacyEpoch,recipientUserId,version") {
    return false;
  }
  return value.version === 1
    && value.recipientUserId === recipientUserId
    && value.coupleId === coupleId
    && Number.isSafeInteger(value.privacyEpoch)
    && (value.privacyEpoch as number) >= 1
    && value.active === true
    && typeof value.expiresAt === "string"
    && value.expiresAt.length <= 40
    && Number.isFinite(Date.parse(value.expiresAt));
}

/**
 * Seals only an opaque owner/couple safety fence. The caller must never pass
 * raw disclosure, summary, reason, classification, or inferred partner state.
 * A false result is logged without identifiers; time-critical safety guidance
 * remains the responsibility of the caller.
 */
export async function sealMediationPrivateSafetyHold({
  client,
  coupleId,
  recipientUserId,
}: SealMediationPrivateSafetyHoldInput): Promise<boolean> {
  if (!isUuid(coupleId) || !isUuid(recipientUserId)) return false;
  try {
    const { data, error } = await client.rpc(
      "seal_amora_mediation_private_safety_hold",
      {
        p_couple_id: coupleId.toLowerCase(),
        p_recipient_user_id: recipientUserId.toLowerCase(),
      },
    );
    if (
      error
      || !isExactSealReceipt(
        data,
        coupleId.toLowerCase(),
        recipientUserId.toLowerCase(),
      )
    ) {
      console.error("[mediation-private-safety-hold] opaque seal unavailable");
      return false;
    }
    return true;
  } catch {
    console.error("[mediation-private-safety-hold] opaque seal unavailable");
    return false;
  }
}
