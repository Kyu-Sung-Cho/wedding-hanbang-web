import { createClient } from "@/lib/supabase/client";
import { CategoryId } from "@/types";

export interface BudgetRow {
  id: string;
  couple_id: string;
  total_budget: number;
  category_budgets: Record<string, number>;
  created_at: string;
  updated_at: string;
}

export interface BudgetItemRow {
  id: string;
  couple_id: string;
  category_id: string;
  amount: number;
  description: string;
  vendor_name: string | null;
  memo: string | null;
  date: string;
  created_at: string;
  updated_at: string;
}

// 예산 조회 또는 생성
export async function getOrCreateBudget(coupleId: string): Promise<BudgetRow | null> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("budgets")
    .select("*")
    .eq("couple_id", coupleId)
    .single();

  if (data) return data as BudgetRow;

  if (error && error.code === "PGRST116") {
    const { data: newBudget, error: createError } = await supabase
      .from("budgets")
      .insert({
        couple_id: coupleId,
        total_budget: 0,
        category_budgets: {},
      })
      .select()
      .single();

    if (createError) {
      console.error("예산 생성 실패:", createError);
      return null;
    }
    return newBudget as BudgetRow;
  }

  console.error("예산 조회 실패:", error);
  return null;
}

// 총 예산 업데이트
export async function updateTotalBudget(coupleId: string, totalBudget: number) {
  const supabase = createClient();

  const { error } = await supabase
    .from("budgets")
    .upsert(
      {
        couple_id: coupleId,
        total_budget: totalBudget,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "couple_id" }
    );

  if (error) {
    console.error("총 예산 업데이트 실패:", error);
    return false;
  }
  return true;
}

// 카테고리별 예산 업데이트
export async function updateCategoryBudget(
  coupleId: string,
  categoryId: CategoryId,
  amount: number
) {
  const supabase = createClient();

  // 현재 카테고리 예산 가져오기
  const { data: budget } = await supabase
    .from("budgets")
    .select("category_budgets")
    .eq("couple_id", coupleId)
    .single();

  const categoryBudgets = (budget?.category_budgets as Record<string, number>) || {};
  categoryBudgets[categoryId] = amount;

  const { error } = await supabase
    .from("budgets")
    .upsert(
      {
        couple_id: coupleId,
        category_budgets: categoryBudgets,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "couple_id" }
    );

  if (error) {
    console.error("카테고리 예산 업데이트 실패:", error);
    return false;
  }
  return true;
}

// 지출 항목 조회
export async function getBudgetItems(coupleId: string): Promise<BudgetItemRow[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("budget_items")
    .select("*")
    .eq("couple_id", coupleId)
    .order("date", { ascending: false });

  if (error) {
    console.error("지출 항목 조회 실패:", error);
    return [];
  }
  return (data || []) as BudgetItemRow[];
}

// 지출 항목 추가
export async function addBudgetItem(
  coupleId: string,
  item: {
    category_id: string;
    amount: number;
    description: string;
    vendor_name?: string;
    memo?: string;
    date: string;
  }
) {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("budget_items")
    .insert({
      couple_id: coupleId,
      ...item,
    })
    .select()
    .single();

  if (error) {
    console.error("지출 추가 실패:", error);
    return null;
  }
  return data as BudgetItemRow;
}

// 지출 항목 삭제
export async function deleteBudgetItem(itemId: string) {
  const supabase = createClient();

  const { error } = await supabase
    .from("budget_items")
    .delete()
    .eq("id", itemId);

  if (error) {
    console.error("지출 삭제 실패:", error);
    return false;
  }
  return true;
}

// 예산 실시간 구독
export function subscribeToBudget(
  coupleId: string,
  callbacks: {
    onBudgetChange?: (budget: BudgetRow) => void;
    onItemChange?: () => void;
  }
) {
  const supabase = createClient();

  const channel = supabase
    .channel(`budget:${coupleId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "budgets",
        filter: `couple_id=eq.${coupleId}`,
      },
      (payload) => {
        if (payload.new && callbacks.onBudgetChange) {
          callbacks.onBudgetChange(payload.new as BudgetRow);
        }
      }
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "budget_items",
        filter: `couple_id=eq.${coupleId}`,
      },
      () => {
        if (callbacks.onItemChange) {
          callbacks.onItemChange();
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
