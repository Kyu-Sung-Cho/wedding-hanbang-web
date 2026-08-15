import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

import {
  createPrivateMediationSafetyHoldRuntime,
} from "./privateMediationSafetyHold.mjs";

const MOBILE_PRIVATE_SAFETY_HOLD_IO_TIMEOUT_MS = 1_000;

type PrivateMediationSafetyHoldOwner = {
  ownerUserId: string;
  coupleId: string;
};

const privateMediationSafetyHoldRuntime = createPrivateMediationSafetyHoldRuntime({
  digestSha256: (input) => Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    input,
  ),
  writeSecure: (key, value) => SecureStore.setItemAsync(
    key,
    value,
    { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
  ),
  writeJournal: (key, value) => AsyncStorage.setItem(key, value),
  readSecure: (key) => SecureStore.getItemAsync(key),
  readJournal: (key) => AsyncStorage.getItem(key),
}, { timeoutMs: MOBILE_PRIVATE_SAFETY_HOLD_IO_TIMEOUT_MS });

export async function sealPrivateMediationSafetyHold(
  owner: PrivateMediationSafetyHoldOwner,
): Promise<void> {
  await privateMediationSafetyHoldRuntime.seal(owner);
}

export async function hasPrivateMediationSafetyHold(
  owner: PrivateMediationSafetyHoldOwner,
): Promise<boolean> {
  return privateMediationSafetyHoldRuntime.has(owner);
}
