export type EtiquetteScheduleSaveMode = "add" | "update";

export type EtiquetteScheduleSaveResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export async function persistEtiquetteSchedule<TProgress>({
  nextProgress,
  mode,
  updateJourney,
}: {
  nextProgress: TProgress;
  mode: EtiquetteScheduleSaveMode;
  updateJourney: (updates: { progress: TProgress }) => Promise<boolean>;
}): Promise<EtiquetteScheduleSaveResult> {
  try {
    const saved = await updateJourney({ progress: nextProgress });
    if (!saved) {
      return {
        ok: false,
        message: "공동 일정을 저장하지 못했습니다. 입력한 내용은 그대로 두었으니 다시 시도해주세요.",
      };
    }

    return {
      ok: true,
      message: mode === "update" ? "공동 일정을 수정했습니다." : "공동 일정에 추가했습니다.",
    };
  } catch {
    return {
      ok: false,
      message: "공동 일정을 저장하지 못했습니다. 입력한 내용은 그대로 두었으니 다시 시도해주세요.",
    };
  }
}
