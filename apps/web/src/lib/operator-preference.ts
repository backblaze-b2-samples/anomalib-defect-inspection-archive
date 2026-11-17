/**
 * The review queue's Operator field, remembered per browser so an operator
 * working through the queue types their initials once, not once per part.
 * Storage can be missing or blocked (private mode, SSR): every access is
 * guarded and falls back to an empty field.
 */
import { APP_SLUG } from "@/lib/app-config";

export const OPERATOR_STORAGE_KEY = `${APP_SLUG}-review-operator`;

export function loadOperator(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(OPERATOR_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveOperator(operator: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(OPERATOR_STORAGE_KEY, operator.trim());
  } catch {
    // Not remembered this time; the verdict itself was already recorded.
  }
}
