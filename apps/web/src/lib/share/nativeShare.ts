export type NativeShareOutcome =
  | "shared-file"
  | "shared-text"
  | "cancelled"
  | "unavailable";

type ShareNavigator = {
  share?: (data?: ShareData) => Promise<void>;
  canShare?: (data?: ShareData) => boolean;
};

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export async function shareFileThenText({
  shareNavigator,
  fileData,
  textData,
}: {
  shareNavigator: ShareNavigator;
  fileData: ShareData;
  textData: ShareData;
}): Promise<NativeShareOutcome> {
  if (typeof shareNavigator.share !== "function") return "unavailable";

  let canShareFile = false;
  if (typeof shareNavigator.canShare === "function") {
    try {
      canShareFile = shareNavigator.canShare(fileData);
    } catch {
      canShareFile = false;
    }
  }

  if (canShareFile) {
    try {
      await shareNavigator.share(fileData);
      return "shared-file";
    } catch (error) {
      if (isAbortError(error)) return "cancelled";
    }
  }

  try {
    await shareNavigator.share(textData);
    return "shared-text";
  } catch (error) {
    if (isAbortError(error)) return "cancelled";
    return "unavailable";
  }
}
