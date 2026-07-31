import { notFound } from "next/navigation";

/**
 * The pre-MVP research survey collected contact details under an obsolete
 * questionnaire and consent scope. Keep the old URL closed until a new study,
 * disclosure, retention period, and consent flow are reviewed together.
 */
export default function RetiredCustomerSurveyPage(): never {
  notFound();
}
