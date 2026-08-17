import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

import type { AmoraPreparationCatchUpDraftSubmission } from "@hanbang/shared/amora-preparation-catch-up";
import { createPreparationCatchUpDraftRuntime } from "./preparationCatchUpDraft.mjs";

type Owner = { ownerUserId: string };
type Draft = {
  phase: "edit" | "preview";
  requestId: string | null;
  requestLocked: boolean;
  items: AmoraPreparationCatchUpDraftSubmission["items"];
};

const runtime = createPreparationCatchUpDraftRuntime({
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

export function stagePreparationCatchUpDraft(input: Owner & Draft): Promise<void> {
  return runtime.stage(input);
}

export function readPreparationCatchUpDraft(owner: Owner): Promise<Draft | null> {
  return runtime.read(owner);
}

export function clearPreparationCatchUpDraft(owner: Owner): Promise<boolean> {
  return runtime.clear(owner);
}
