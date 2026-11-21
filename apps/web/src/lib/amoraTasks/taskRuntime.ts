import { reserveAmoraTurn } from "@/lib/ai/costGuard";
import { createAdminClient } from "@/lib/supabase/admin";
import { ymdInKst } from "@/lib/utils/kstDate";
import { log } from "@/utils/log";
import { defaultAmoraTaskAdapters } from "./adapters";
import { isAmoraTasksEnabled } from "./config";
import { amoraTaskFailure } from "./report";
import { createOpenAITaskModelCaller } from "./taskModel";
import { createSupabaseAmoraTaskStore } from "./taskStore";
import { executeAmoraTaskReadTool, loadAmoraTaskCoupleNames, loadAmoraTaskWeddingContext } from "./taskTools";
import { runAmoraTaskWorker, type AmoraTaskWorkerDeps, type AmoraTaskWorkerStats } from "./taskWorker";

/** 운영의 일꾼 부품. 시험은 `AmoraTaskWorkerDeps` 를 직접 만들어 넘긴다. */
export function createAmoraTaskWorkerDeps(admin = createAdminClient()): AmoraTaskWorkerDeps {
  return {
    store: createSupabaseAmoraTaskStore(admin),
    adapters: defaultAmoraTaskAdapters(),
    callModel: createOpenAITaskModelCaller(),
    readTool: executeAmoraTaskReadTool,
    loadWeddingContext: (coupleId) => loadAmoraTaskWeddingContext(admin, coupleId),
    loadCoupleNames: (coupleId) => loadAmoraTaskCoupleNames(admin, coupleId),
    // 전역 지갑. 기억 크론과 같은 background 몫으로 서비스 전체 하루 금액 상한을 원자적으로 깎는다.
    reserveGlobalWallet: async (coupleId, costMicrousd) => {
      const reservation = await reserveAmoraTurn(admin, {
        coupleId,
        isAdmin: false,
        quotaScope: "background",
        maxCostMicrousd: costMicrousd,
      });
      return reservation.allowed;
    },
    todayYmd: () => ymdInKst(new Date()),
    nowMs: () => Date.now(),
  };
}

/** 크론 한 번의 작업량. 함수 한 번(120초) 안에 끝나게 잡는다. */
export const AMORA_TASK_CRON_BUDGET = Object.freeze({ maxSlices: 4, budgetMs: 80_000 });
/** 맡기기 직후 한 번. 사용자 응답은 기다리지 않는다(after 에 이미 시작한 약속을 넘긴다). */
export const AMORA_TASK_KICK_BUDGET = Object.freeze({ maxSlices: 1, budgetMs: 40_000 });

export async function runAmoraTaskWorkerOnce(
  budget: { maxSlices: number; budgetMs: number },
): Promise<AmoraTaskWorkerStats | null> {
  if (!isAmoraTasksEnabled()) return null;
  try {
    return await runAmoraTaskWorker(createAmoraTaskWorkerDeps(), budget);
  } catch (error) {
    log.error("[amora-tasks] worker run failed", amoraTaskFailure("AMORA_TASKS_KICK_FAILED", error));
    return null;
  }
}
