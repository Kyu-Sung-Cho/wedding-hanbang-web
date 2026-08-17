import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

import type { PlanningFoundationSelfReportedStage } from "@hanbang/shared";
import { createPlanningFoundationDraftHandoffRuntime } from "./planningFoundationDraftHandoff.mjs";

type Owner = { ownerUserId: string; coupleId: string };

const runtime = createPlanningFoundationDraftHandoffRuntime({
  digestSha256: (input) => Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    input,
  ),
  readSecure: (key) => SecureStore.getItemAsync(key),
  writeSecure: (key, value) => SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  }),
  deleteSecure: (key) => SecureStore.deleteItemAsync(key),
});

export function stagePlanningFoundationDraftHandoff(input: Owner & {
  stage: PlanningFoundationSelfReportedStage;
}): Promise<void> {
  return runtime.stage(input);
}

export function readPlanningFoundationDraftHandoff(
  owner: Owner,
): Promise<PlanningFoundationSelfReportedStage | null> {
  return runtime.read(owner);
}

export function clearPlanningFoundationDraftHandoff(owner: Owner): Promise<boolean> {
  return runtime.clear(owner);
}
