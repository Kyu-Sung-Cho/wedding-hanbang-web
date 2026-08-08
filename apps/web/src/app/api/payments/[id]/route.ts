import {
  mapPaymentLedgerRow,
  parsePaymentLedgerUpdate,
} from "@/lib/payments/paymentLedger";
import { isWeddingPaymentLedgerEnabled } from "@/lib/features/weddingLaunchFlags";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isUuid } from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

import {
  paymentJson,
  readPaymentJson,
  resolvePaymentScope,
} from "../paymentRouteSupport";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!isWeddingPaymentLedgerEnabled()) {
    return paymentJson(
      {
        error: "계약·지급 기록 기능을 현재 사용할 수 없습니다.",
        code: "PAYMENT_LEDGER_DISABLED",
      },
      { status: 404 },
    );
  }
  if (!isTrustedMutationRequest(request)) {
    return paymentJson(
      { error: "잘못된 요청 출처입니다." },
      { status: 403 },
    );
  }

  try {
    const { id } = await context.params;
    if (!isUuid(id)) {
      return paymentJson(
        { error: "계약·지급 기록 식별자가 올바르지 않습니다." },
        { status: 400 },
      );
    }

    const resolved = await resolvePaymentScope(request);
    if (!resolved.ok) return resolved.response;
    const { admin, coupleId, userId } = resolved.scope;

    const limited = checkRateLimit(
      rateLimitKey("payments:update", request, userId),
      { maxRequests: 60, windowMs: 60 * 1000 },
    );
    if (limited) {
      limited.headers.set("Cache-Control", "private, no-store, max-age=0");
      limited.headers.set(
        "Vary",
        "Origin, Sec-Fetch-Site, Authorization",
      );
      return limited;
    }

    const json = await readPaymentJson(request);
    if (!json.ok) return json.response;
    const parsed = parsePaymentLedgerUpdate(json.body);
    if (!parsed.ok) {
      return paymentJson({ error: parsed.error }, { status: 400 });
    }
    const { revision, ...values } = parsed.value;
    const { data, error } = await admin.rpc(
      "update_wedding_payment_ledger",
      {
        p_user_id: userId,
        p_couple_id: coupleId,
        p_entry_id: id,
        p_expected_revision: revision,
        p_item_name: values.itemName,
        p_vendor_display_name: values.vendorDisplayName,
        p_category_key: values.categoryKey,
        p_contract_amount_won: values.contractAmountWon,
        p_paid_amount_won: values.paidAmountWon,
        p_balance_due_date: values.balanceDueDate,
        p_refundable_amount_won: values.refundableAmountWon,
        p_status: values.status,
        p_evidence_status: values.evidenceStatus,
      },
    );
    if (error) {
      console.error("[payments] update failed", { code: error.code });
      const failure = `${error.code ?? ""} ${error.message ?? ""}`;
      if (failure.includes("PAYMENT_LEDGER_SCOPE_DENIED")) {
        return paymentJson(
          { error: "현재 커플의 기록을 바꿀 권한이 없습니다." },
          { status: 403 },
        );
      }
      if (failure.includes("PAYMENT_LEDGER_NOT_FOUND")) {
        return paymentJson(
          { error: "계약·지급 기록을 찾을 수 없습니다." },
          { status: 404 },
        );
      }
      if (failure.includes("PAYMENT_LEDGER_REVISION_CONFLICT")) {
        return paymentJson(
          {
            error: "상대방이 먼저 수정한 내용이 있어 최신 기록을 다시 불러왔어요.",
            code: "PAYMENT_LEDGER_REVISION_CONFLICT",
          },
          { status: 409 },
        );
      }
      return paymentJson(
        { error: "계약·지급 기록을 수정하지 못했습니다." },
        { status: 503 },
      );
    }

    const payment = mapPaymentLedgerRow(data, userId);
    if (!payment) {
      console.error("[payments] invalid update receipt");
      return paymentJson(
        { error: "수정 결과를 안전하게 확인하지 못했습니다." },
        { status: 503 },
      );
    }
    return paymentJson({ payment });
  } catch (error) {
    console.error("[payments] unexpected update failure", {
      name: error instanceof Error ? error.name : "unknown",
    });
    return paymentJson({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
