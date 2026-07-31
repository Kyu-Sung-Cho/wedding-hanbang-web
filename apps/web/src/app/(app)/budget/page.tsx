import BudgetContent from "@/components/app/budget/BudgetContent";
import { isWeddingPaymentLedgerEnabled } from "@/lib/features/weddingLaunchFlags";

export default function BudgetPage() {
  return (
    <BudgetContent
      paymentLedgerEnabled={isWeddingPaymentLedgerEnabled()}
    />
  );
}
