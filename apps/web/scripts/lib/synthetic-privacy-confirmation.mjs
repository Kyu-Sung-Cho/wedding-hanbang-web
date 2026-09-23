// Only the hosted harness's synthetic users may be passed to these helpers.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function readSyntheticPrivacyTarget(user, coupleId) {
  const ownerId = user?.id;
  if (typeof ownerId !== "string" || !UUID.test(ownerId)
    || typeof coupleId !== "string" || !UUID.test(coupleId)) throw new Error("SYNTHETIC_PRIVACY_TARGET_UNAVAILABLE");
  const verified = await user.client.auth.getUser();
  if (verified.error || verified.data?.user?.id !== ownerId) throw new Error("SYNTHETIC_PRIVACY_OWNER_MISMATCH");
  const { data, error } = await user.client.rpc("get_own_amora_privacy_epoch", {
    p_couple_id: coupleId, p_visibility: "shared",
  });
  const privacyEpoch = typeof data === "string" && /^\d+$/.test(data) ? Number(data) : data;
  if (error || typeof privacyEpoch !== "number" || !Number.isSafeInteger(privacyEpoch) || privacyEpoch < 1) {
    throw new Error("SYNTHETIC_PRIVACY_TARGET_UNAVAILABLE");
  }
  return { ownerId, coupleId, privacyEpoch };
}

export async function mutateSyntheticMemoryWithConfirmation({ admin, user, coupleId, visibility, action, consented = null }) {
  const target = await readSyntheticPrivacyTarget(user, coupleId);
  return admin.rpc("mutate_amora_memory_with_confirmation", {
    p_couple_id: target.coupleId,
    p_visibility: visibility,
    p_user_id: target.ownerId,
    p_expected_privacy_epoch: target.privacyEpoch,
    p_action: action,
    p_consented: consented,
  });
}

export async function verifySyntheticResetConfirmation({ admin, user, coupleId }) {
  const target = await readSyntheticPrivacyTarget(user, coupleId);
  const args = Object.freeze({
    p_expected_user_id: target.ownerId,
    p_expected_couple_id: target.coupleId,
    p_expected_privacy_epoch: target.privacyEpoch,
  });
  const missing = await user.client.rpc("reset_current_couple_membership");
  if (missing.error?.code !== "22023") throw new Error("SYNTHETIC_RESET_MISSING_TARGET_NOT_REJECTED");
  const service = await admin.rpc("reset_current_couple_membership", args);
  if (service.error?.code !== "42501") throw new Error("SYNTHETIC_RESET_SERVICE_NOT_REJECTED");
  const result = await user.client.rpc("reset_current_couple_membership", args);
  if (result.error || result.data?.success !== true || result.data?.previous_couple_id !== target.coupleId) {
    throw new Error("SYNTHETIC_RESET_POSTCONDITION_FAILED");
  }
  // A completed reset invalidates this confirmation; never refresh/rebase its retry.
  const retry = await user.client.rpc("reset_current_couple_membership", args);
  if (retry.error?.code !== "40001") throw new Error("SYNTHETIC_RESET_STALE_TARGET_NOT_REJECTED");
  return result.data;
}
