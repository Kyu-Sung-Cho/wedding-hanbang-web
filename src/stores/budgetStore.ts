import { create } from "zustand";
import { persist } from "zustand/middleware";
import { CategoryId } from "@/types";
import * as budgetService from "@/lib/services/budgetService";

interface Expense {
  id: string;
  amount: number;
  description: string;
  date: string;
  vendorName?: string;
  memo?: string;
  createdAt: string;
}

interface CategoryBudget {
  categoryId: CategoryId;
  budgetAmount: number;
  spentAmount: number;
  expenses: Expense[];
}

interface BudgetState {
  totalBudget: number;
  categoryBudgets: Record<string, CategoryBudget>;
  isInitialized: boolean;
  coupleId: string | null;
  isSyncing: boolean;
}

interface BudgetActions {
  setTotalBudget: (amount: number) => void;
  setCategoryBudget: (categoryId: CategoryId, amount: number) => void;
  addExpense: (categoryId: CategoryId, expense: Omit<Expense, "id" | "createdAt">) => void;
  deleteExpense: (categoryId: CategoryId, expenseId: string) => void;
  getTotalSpent: () => number;
  getTotalRemaining: () => number;
  resetBudget: () => void;
  setCoupleId: (id: string | null) => void;
  // Supabase 동기화
  loadFromServer: (coupleId: string) => Promise<void>;
}

let budgetSyncTimeout: ReturnType<typeof setTimeout> | null = null;

function debouncedBudgetSync(fn: () => void) {
  if (budgetSyncTimeout) clearTimeout(budgetSyncTimeout);
  budgetSyncTimeout = setTimeout(fn, 1500);
}

export const useBudgetStore = create<BudgetState & BudgetActions>()(
  persist(
    (set, get) => ({
      totalBudget: 0,
      categoryBudgets: {},
      isInitialized: false,
      coupleId: null,
      isSyncing: false,

      setCoupleId: (coupleId) => set({ coupleId }),

      setTotalBudget: (amount) => {
        set({ totalBudget: amount, isInitialized: true });
        const { coupleId } = get();
        if (coupleId) {
          debouncedBudgetSync(() => {
            budgetService.updateTotalBudget(coupleId, amount);
          });
        }
      },

      setCategoryBudget: (categoryId, amount) => {
        set((state) => {
          const existing = state.categoryBudgets[categoryId] || {
            categoryId,
            budgetAmount: 0,
            spentAmount: 0,
            expenses: [],
          };
          return {
            categoryBudgets: {
              ...state.categoryBudgets,
              [categoryId]: { ...existing, budgetAmount: amount },
            },
          };
        });
        const { coupleId } = get();
        if (coupleId) {
          debouncedBudgetSync(() => {
            budgetService.updateCategoryBudget(coupleId, categoryId, amount);
          });
        }
      },

      addExpense: (categoryId, expense) => {
        const newId = crypto.randomUUID();
        const newExpense: Expense = {
          ...expense,
          id: newId,
          createdAt: new Date().toISOString(),
        };

        set((state) => {
          const existing = state.categoryBudgets[categoryId] || {
            categoryId,
            budgetAmount: 0,
            spentAmount: 0,
            expenses: [],
          };
          const newExpenses = [...existing.expenses, newExpense];
          const spentAmount = newExpenses.reduce((sum, e) => sum + e.amount, 0);
          return {
            categoryBudgets: {
              ...state.categoryBudgets,
              [categoryId]: { ...existing, expenses: newExpenses, spentAmount },
            },
          };
        });

        // Supabase에 지출 저장
        const { coupleId } = get();
        if (coupleId) {
          budgetService.addBudgetItem(coupleId, {
            category_id: categoryId,
            amount: expense.amount,
            description: expense.description,
            vendor_name: expense.vendorName,
            memo: expense.memo,
            date: expense.date,
          });
        }
      },

      deleteExpense: (categoryId, expenseId) => {
        set((state) => {
          const existing = state.categoryBudgets[categoryId];
          if (!existing) return state;
          const newExpenses = existing.expenses.filter((e) => e.id !== expenseId);
          const spentAmount = newExpenses.reduce((sum, e) => sum + e.amount, 0);
          return {
            categoryBudgets: {
              ...state.categoryBudgets,
              [categoryId]: { ...existing, expenses: newExpenses, spentAmount },
            },
          };
        });

        // Supabase에서 삭제
        budgetService.deleteBudgetItem(expenseId);
      },

      getTotalSpent: () => {
        const { categoryBudgets } = get();
        return Object.values(categoryBudgets || {}).reduce((sum, cb) => sum + cb.spentAmount, 0);
      },

      getTotalRemaining: () => {
        const { totalBudget } = get();
        return totalBudget - get().getTotalSpent();
      },

      resetBudget: () => set({ totalBudget: 0, categoryBudgets: {}, isInitialized: false }),

      // Supabase에서 예산 데이터 로드
      loadFromServer: async (coupleId: string) => {
        try {
          set({ coupleId, isSyncing: true });

          // 예산 정보 로드
          const budget = await budgetService.getOrCreateBudget(coupleId);
          if (budget) {
            const categoryBudgetsFromServer: Record<string, CategoryBudget> = {};
            const serverCategoryBudgets = (budget.category_budgets || {}) as Record<string, number>;

            // 카테고리별 예산 금액 설정
            for (const [catId, amount] of Object.entries(serverCategoryBudgets)) {
              categoryBudgetsFromServer[catId] = {
                categoryId: catId as CategoryId,
                budgetAmount: amount,
                spentAmount: 0,
                expenses: [],
              };
            }

            // 지출 항목 로드
            const items = await budgetService.getBudgetItems(coupleId);
            for (const item of items) {
              const catId = item.category_id;
              if (!categoryBudgetsFromServer[catId]) {
                categoryBudgetsFromServer[catId] = {
                  categoryId: catId as CategoryId,
                  budgetAmount: 0,
                  spentAmount: 0,
                  expenses: [],
                };
              }
              categoryBudgetsFromServer[catId].expenses.push({
                id: item.id,
                amount: item.amount,
                description: item.description,
                date: item.date,
                vendorName: item.vendor_name || undefined,
                memo: item.memo || undefined,
                createdAt: item.created_at,
              });
            }

            // spentAmount 재계산
            for (const catBudget of Object.values(categoryBudgetsFromServer)) {
              catBudget.spentAmount = catBudget.expenses.reduce((sum, e) => sum + e.amount, 0);
            }

            set({
              totalBudget: budget.total_budget || 0,
              categoryBudgets: categoryBudgetsFromServer,
              isInitialized: true,
            });
          }
        } catch (error) {
          console.error("서버에서 예산 로드 실패:", error);
        } finally {
          set({ isSyncing: false });
        }
      },
    }),
    { name: "budget-store" }
  )
);
