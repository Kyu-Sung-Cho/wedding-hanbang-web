import {
  mapPaymentLedgerRow,
  parsePaymentLedgerCreateRequest,
  PAYMENT_LEDGER_SELECT,
} from "@/lib/payments/paymentLedger";
import { isWeddingPaymentLedgerEnabled } from "@/lib/features/weddingLaunchFlags";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

import {
  PAYMENT_API_MAX_ENTRIES,
  paymentJson,
  readPaymentJson,
  resolvePaymentScope,
} from "./paymentRouteSupport";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isWeddingPaymentLedgerEnabled()) {
    return paymentJson(
      {
        error: "계약·지급 기록 기능을 현재 사용할 수 없습니다.",
        code: "PAYMENT_LEDGER_DISABLED",
      },
      { status: 404 },
    );
  }
  try {
    const resolved = await resolvePaymentScope(request);
    if (!resolved.ok) return resolved.response;
    const { coupleId, userClient, userId } = resolved.scope;

    // 최종 조회는 request-scoped authenticated client와 RLS가 같은 SQL
    // statement에서 현재 membership을 다시 확인한다.
    const { data, error } = await userClient
      .from("wedding_payment_ledger")
      .select(PAYMENT_LEDGER_SELECT)
      .eq("couple_id", coupleId)
      .order("balance_due_date", { ascending: true, nullsFirst: false })
      .order("updated_at", { ascending: false })
      .limit(PAYMENT_API_MAX_ENTRIES);
    if (error) {
      console.error("[payments] list failed", { code: error.code });
      return paymentJson(
        { error: "계약·지급 기록을 불러오지 못했습니다." },
        { status: 503 },
      );
    }

    const payments = (Array.isArray(data) ? data : []).map((row) =>
      mapPaymentLedgerRow(row, userId)
    );
    if (payments.some((payment) => payment === null)) {
      console.error("[payments] invalid persisted row");
      return paymentJson(
        { error: "저장된 금액 정보를 안전하게 확인하지 못했습니다." },
        { status: 503 },
      );
    }

    return paymentJson({ payments });
  } catch (error) {
    console.error("[payments] unexpected list failure", {
      name: error instanceof Error ? error.name : "unknown",
    });
    return paymentJson({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request) {
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
    const resolved = await resolvePaymentScope(request);
    if (!resolved.ok) return resolved.response;
    const { admin, coupleId, userId } = resolved.scope;

    const limited = checkRateLimit(
      rateLimitKey("payments:create", request, userId),
      { maxRequests: 30, windowMs: 60 * 1000 },
    );
    if (limited) {
      for (const [name, value] of Object.entries({
        "Cache-Control": "private, no-store, max-age=0",
        Vary: "Origin, Sec-Fetch-Site, Authorization",
      })) {
        limited.headers.set(name, value);
      }
      return limited;
    }

    const json = await readPaymentJson(request);
    if (!json.ok) return json.response;
    const parsed = parsePaymentLedgerCreateRequest(json.body);
    if (!parsed.ok) {
      return paymentJson({ error: parsed.error }, { status: 400 });
    }
    const { clientRequestId, ...values } = parsed.value;
    const { data, error } = await admin.rpc(
      "create_wedding_payment_ledger",
      {
        p_user_id: userId,
        p_couple_id: coupleId,
        p_client_request_id: clientRequestId,
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
      console.error("[payments] create failed", { code: error.code });
      const failure = `${error.code ?? ""} ${error.message ?? ""}`;
      if (failure.includes("PAYMENT_LEDGER_SCOPE_DENIED")) {
        return paymentJson(
          { error: "현재 커플의 기록을 바꿀 권한이 없습니다." },
          { status: 403 },
        );
      }
      if (failure.includes("PAYMENT_LEDGER_IDEMPOTENCY_CONFLICT")) {
        return paymentJson(
          {
            error: "같은 저장 요청의 내용이 달라 아무것도 추가하지 않았어요. 목록을 다시 확인해 주세요.",
            code: "PAYMENT_LEDGER_IDEMPOTENCY_CONFLICT",
          },
          { status: 409 },
        );
      }
      if (failure.includes("PAYMENT_LEDGER_LIMIT")) {
        return paymentJson(
          {
            error: `계약·지급 기록은 ${PAYMENT_API_MAX_ENTRIES}개까지 보관할 수 있어요. 기존 항목을 취소 상태로 정리한 뒤 고객지원에 문의해 주세요.`,
            code: "PAYMENT_LEDGER_LIMIT",
          },
          { status: 409 },
        );
      }
      return paymentJson(
        { error: "계약·지급 기록을 저장하지 못했습니다." },
        { status: 503 },
      );
    }

    const payment = mapPaymentLedgerRow(data, userId);
    if (!payment) {
      console.error("[payments] invalid create receipt");
      return paymentJson(
        { error: "저장 결과를 안전하게 확인하지 못했습니다." },
        { status: 503 },
      );
    }
    return paymentJson({ payment }, { status: 201 });
  } catch (error) {
    console.error("[payments] unexpected create failure", {
      name: error instanceof Error ? error.name : "unknown",
    });
    return paymentJson({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
