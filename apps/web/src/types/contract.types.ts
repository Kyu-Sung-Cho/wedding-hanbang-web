// ============================================
// 계약 & 결제 시스템 타입 정의
// ============================================

// --- 계약 상태 ---
export type ContractStatus = "draft" | "sent" | "viewed" | "signed" | "cancelled";
export type PaymentStatus = "pending" | "paid" | "refunded" | "failed";
export type PaymentType = "deposit" | "remaining" | "refund";
export type PaymentMethod = "card" | "naverpay" | "kakaopay" | "tosspay" | "transfer" | "vbank";
// cancelled: 지급 전 환불로 정산 취소 / clawback_required: 지급 후 환불 — 업체 회수 필요
export type SettlementStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled"
  | "clawback_required";

// --- 계약 조항 ---
export interface ContractClause {
  title: string;
  body: string;
}

// --- 취소 정책 항목 ---
export interface CancellationPolicyItem {
  daysBefore: number;    // 서비스 D-N일 전
  refundPercent: number; // 환불 비율 (0~100)
  label: string;         // "7일 전: 100% 환불"
}

// ============================================
// DB Row 타입 (snake_case)
// ============================================

export interface ContractTemplateRow {
  id: string;
  category: string;
  title: string;
  content: ContractClause[];
  cancellation_policy: CancellationPolicyItem[];
  default_deposit_rate: number;
  is_active: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface VendorContractTemplateRow {
  id: string;
  vendor_id: string;
  base_template_id: string | null;
  title: string;
  content: ContractClause[];
  cancellation_policy: CancellationPolicyItem[];
  deposit_rate: number;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface ContractRow {
  id: string;
  booking_id: string;
  vendor_id: string;
  customer_id: string;
  template_id: string | null;
  content: ContractClause[];
  contract_amount: number;
  deposit_amount: number;
  deposit_rate: number;
  cancellation_policy: CancellationPolicyItem[];
  status: ContractStatus;
  sent_at: string | null;
  viewed_at: string | null;
  signed_at: string | null;
  signed_name: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface PaymentRow {
  id: string;
  contract_id: string;
  booking_id: string;
  customer_id: string;
  vendor_id: string;
  payment_type: PaymentType;
  amount: number;
  method: PaymentMethod | null;
  status: PaymentStatus;
  toss_payment_key: string | null;
  toss_transaction_key: string | null;
  order_id: string | null;
  paid_at: string | null;
  failed_at: string | null;
  fail_reason: string | null;
  refunded_at: string | null;
  refund_amount: number | null;
  receipt_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface SettlementRow {
  id: string;
  payment_id: string;
  vendor_id: string;
  booking_id: string;
  total_amount: number;
  commission_rate: number;
  commission_amount: number;
  settle_amount: number;
  status: SettlementStatus;
  settled_at: string | null;
  bank_name: string | null;
  account_number: string | null;
  account_holder: string | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================
// 프론트엔드용 camelCase 타입
// ============================================

export interface ContractTemplate {
  id: string;
  category: string;
  title: string;
  content: ContractClause[];
  cancellationPolicy: CancellationPolicyItem[];
  defaultDepositRate: number;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface VendorContractTemplate {
  id: string;
  vendorId: string;
  baseTemplateId: string | null;
  title: string;
  content: ContractClause[];
  cancellationPolicy: CancellationPolicyItem[];
  depositRate: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Contract {
  id: string;
  bookingId: string;
  vendorId: string;
  customerId: string;
  templateId: string | null;
  content: ContractClause[];
  contractAmount: number;
  depositAmount: number;
  depositRate: number;
  cancellationPolicy: CancellationPolicyItem[];
  status: ContractStatus;
  sentAt: string | null;
  viewedAt: string | null;
  signedAt: string | null;
  signedName: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  // 조인 필드 (선택)
  vendorName?: string;
  productName?: string;
  bookingDate?: string;
}

export interface Payment {
  id: string;
  contractId: string;
  bookingId: string;
  customerId: string;
  vendorId: string;
  paymentType: PaymentType;
  amount: number;
  method: PaymentMethod | null;
  status: PaymentStatus;
  tossPaymentKey: string | null;
  tossTransactionKey: string | null;
  orderId: string | null;
  paidAt: string | null;
  failedAt: string | null;
  failReason: string | null;
  refundedAt: string | null;
  refundAmount: number | null;
  receiptUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Settlement {
  id: string;
  paymentId: string;
  vendorId: string;
  bookingId: string;
  totalAmount: number;
  commissionRate: number;
  commissionAmount: number;
  settleAmount: number;
  status: SettlementStatus;
  settledAt: string | null;
  bankName: string | null;
  accountNumber: string | null;
  accountHolder: string | null;
  memo: string | null;
  createdAt: string;
  updatedAt: string;
  // 조인 필드 (선택)
  vendorName?: string;
}

// ============================================
// Row → camelCase 변환 유틸
// ============================================

export function contractTemplateRowToModel(row: ContractTemplateRow): ContractTemplate {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    content: row.content,
    cancellationPolicy: row.cancellation_policy,
    defaultDepositRate: row.default_deposit_rate,
    isActive: row.is_active,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function vendorContractTemplateRowToModel(row: VendorContractTemplateRow): VendorContractTemplate {
  return {
    id: row.id,
    vendorId: row.vendor_id,
    baseTemplateId: row.base_template_id,
    title: row.title,
    content: row.content,
    cancellationPolicy: row.cancellation_policy,
    depositRate: row.deposit_rate,
    isDefault: row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function contractRowToModel(row: ContractRow): Contract {
  return {
    id: row.id,
    bookingId: row.booking_id,
    vendorId: row.vendor_id,
    customerId: row.customer_id,
    templateId: row.template_id,
    content: row.content,
    contractAmount: row.contract_amount,
    depositAmount: row.deposit_amount,
    depositRate: row.deposit_rate,
    cancellationPolicy: row.cancellation_policy,
    status: row.status,
    sentAt: row.sent_at,
    viewedAt: row.viewed_at,
    signedAt: row.signed_at,
    signedName: row.signed_name,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function paymentRowToModel(row: PaymentRow): Payment {
  return {
    id: row.id,
    contractId: row.contract_id,
    bookingId: row.booking_id,
    customerId: row.customer_id,
    vendorId: row.vendor_id,
    paymentType: row.payment_type,
    amount: row.amount,
    method: row.method,
    status: row.status,
    tossPaymentKey: row.toss_payment_key,
    tossTransactionKey: row.toss_transaction_key,
    orderId: row.order_id,
    paidAt: row.paid_at,
    failedAt: row.failed_at,
    failReason: row.fail_reason,
    refundedAt: row.refunded_at,
    refundAmount: row.refund_amount,
    receiptUrl: row.receipt_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function settlementRowToModel(row: SettlementRow): Settlement {
  return {
    id: row.id,
    paymentId: row.payment_id,
    vendorId: row.vendor_id,
    bookingId: row.booking_id,
    totalAmount: row.total_amount,
    commissionRate: row.commission_rate,
    commissionAmount: row.commission_amount,
    settleAmount: row.settle_amount,
    status: row.status,
    settledAt: row.settled_at,
    bankName: row.bank_name,
    accountNumber: row.account_number,
    accountHolder: row.account_holder,
    memo: row.memo,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
