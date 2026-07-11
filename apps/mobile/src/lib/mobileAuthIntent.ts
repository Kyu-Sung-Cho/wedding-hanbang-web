import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  sanitizeMobileAuthReturnPath,
  type MobileAuthReturnPath,
} from "@hanbang/shared";

const PENDING_AUTH_RETURN_PATH_KEY = "@hanbang/pending-auth-return-path/v1";

let activeAuthReturnPath: MobileAuthReturnPath | null = null;

export function setActiveMobileAuthReturnPath(value: unknown): MobileAuthReturnPath | null {
  activeAuthReturnPath = sanitizeMobileAuthReturnPath(value);
  return activeAuthReturnPath;
}

export function clearActiveMobileAuthReturnPath(expected?: MobileAuthReturnPath) {
  if (expected && activeAuthReturnPath !== expected) return;
  activeAuthReturnPath = null;
}

export async function savePendingMobileAuthReturnPath(value: unknown): Promise<boolean> {
  const safePath = sanitizeMobileAuthReturnPath(value);
  if (!safePath) return false;
  await AsyncStorage.setItem(PENDING_AUTH_RETURN_PATH_KEY, safePath);
  return true;
}

export async function persistActiveMobileAuthReturnPath(): Promise<boolean> {
  if (!activeAuthReturnPath) return false;
  return savePendingMobileAuthReturnPath(activeAuthReturnPath);
}

export async function consumePendingMobileAuthReturnPath(): Promise<MobileAuthReturnPath | null> {
  const storedPath = await AsyncStorage.getItem(PENDING_AUTH_RETURN_PATH_KEY);
  if (storedPath === null) return null;

  await AsyncStorage.removeItem(PENDING_AUTH_RETURN_PATH_KEY);
  return sanitizeMobileAuthReturnPath(storedPath);
}
