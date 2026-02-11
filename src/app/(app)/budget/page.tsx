"use client";

import { useState } from "react";
import {
  Wallet, Plus, TrendingUp, AlertCircle,
  ChevronDown, ChevronUp, Trash2, Edit3,
} from "lucide-react";
import { useBudgetStore } from "@/stores/budgetStore";
import { CATEGORIES, getCategoryById } from "@/constants/categories";
import { formatBudgetAmount } from "@/utils/format";
import { CategoryId } from "@/types";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";

export default function BudgetPage() {
  const {
    totalBudget,
    categoryBudgets,
    setTotalBudget,
    setCategoryBudget,
    addExpense,
    deleteExpense,
    getTotalSpent,
    getTotalRemaining,
  } = useBudgetStore();

  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<CategoryId | null>(null);
  const [budgetInput, setBudgetInput] = useState(totalBudget.toString());
  const [selectedCategoryForExpense, setSelectedCategoryForExpense] =
    useState<CategoryId>("wedding_hall");

  // 지출 입력 상태
  const [expenseForm, setExpenseForm] = useState({
    amount: "",
    description: "",
    vendorName: "",
  });

  const totalSpent = getTotalSpent();
  const totalRemaining = getTotalRemaining();
  const spentPercentage = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;

  // 카테고리별 예산 데이터 정렬
  const sortedCategories = CATEGORIES.map((cat) => {
    const budget = categoryBudgets[cat.id];
    return {
      ...cat,
      budgetAmount: budget?.budgetAmount || 0,
      spentAmount: budget?.spentAmount || 0,
      expenses: budget?.expenses || [],
    };
  }).sort((a, b) => b.budgetAmount - a.budgetAmount);

  // 총 예산 설정
  const handleSetBudget = () => {
    const amount = parseInt(budgetInput);
    if (amount > 0) {
      setTotalBudget(amount);
      setShowBudgetModal(false);
    }
  };

  // 지출 추가
  const handleAddExpense = () => {
    const amount = parseInt(expenseForm.amount);
    if (amount > 0 && expenseForm.description) {
      addExpense(selectedCategoryForExpense, {
        amount,
        description: expenseForm.description,
        date: new Date().toISOString().split("T")[0],
        vendorName: expenseForm.vendorName || undefined,
      });
      setExpenseForm({ amount: "", description: "", vendorName: "" });
      setShowExpenseModal(false);
    }
  };

  // 예산 상태 색상
  const getStatusColor = (percentage: number) => {
    if (percentage >= 100) return "text-red-500";
    if (percentage >= 80) return "text-yellow-500";
    if (percentage >= 50) return "text-blue-500";
    return "text-green-500";
  };

  const getBarColor = (percentage: number) => {
    if (percentage >= 100) return "bg-red-500";
    if (percentage >= 80) return "bg-yellow-500";
    if (percentage >= 50) return "bg-blue-500";
    return "bg-green-500";
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* 예산 요약 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="cursor-pointer" hover onClick={() => setShowBudgetModal(true)}>
          <Wallet className="mb-2 h-6 w-6 text-rose-500" />
          <p className="text-sm text-taupe-500">총 예산</p>
          <p className="mt-1 font-display text-2xl font-semibold text-noir-800">
            {totalBudget > 0 ? formatBudgetAmount(totalBudget) : "설정하기"}
          </p>
          {totalBudget === 0 && (
            <p className="mt-1 text-xs text-taupe-400">
              클릭하여 예산을 설정하세요
            </p>
          )}
        </Card>

        <Card>
          <TrendingUp className="mb-2 h-6 w-6 text-blue-500" />
          <p className="text-sm text-taupe-500">사용 금액</p>
          <p className="mt-1 font-display text-2xl font-semibold text-noir-800">
            {formatBudgetAmount(totalSpent)}
          </p>
          {totalBudget > 0 && (
            <p className={`mt-1 text-xs ${getStatusColor(spentPercentage)}`}>
              예산의 {Math.round(spentPercentage)}% 사용
            </p>
          )}
        </Card>

        <Card>
          <AlertCircle
            className={`mb-2 h-6 w-6 ${
              totalRemaining < 0 ? "text-red-500" : "text-green-500"
            }`}
          />
          <p className="text-sm text-taupe-500">남은 예산</p>
          <p
            className={`mt-1 font-display text-2xl font-semibold ${
              totalRemaining < 0 ? "text-red-500" : "text-noir-800"
            }`}
          >
            {totalRemaining < 0 ? "-" : ""}
            {formatBudgetAmount(Math.abs(totalRemaining))}
          </p>
        </Card>
      </div>

      {/* 전체 진행 바 */}
      {totalBudget > 0 && (
        <Card>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-noir-800">예산 사용 현황</span>
            <span className={`text-sm font-medium ${getStatusColor(spentPercentage)}`}>
              {Math.round(spentPercentage)}%
            </span>
          </div>
          <div className="h-3 rounded-full bg-ivory-200">
            <div
              className={`h-full rounded-full transition-all ${getBarColor(spentPercentage)}`}
              style={{ width: `${Math.min(spentPercentage, 100)}%` }}
            />
          </div>
        </Card>
      )}

      {/* 지출 추가 버튼 */}
      <div className="flex justify-end">
        <Button onClick={() => setShowExpenseModal(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          지출 추가
        </Button>
      </div>

      {/* 카테고리별 예산 */}
      <div className="space-y-3">
        {sortedCategories.map((category) => {
          const percentage =
            category.budgetAmount > 0
              ? (category.spentAmount / category.budgetAmount) * 100
              : 0;
          const isExpanded = expandedCategory === category.id;

          return (
            <Card key={category.id} padding="none">
              <button
                onClick={() =>
                  setExpandedCategory(isExpanded ? null : category.id)
                }
                className="flex w-full items-center gap-4 p-4 text-left"
              >
                <span className="text-2xl">{category.emoji}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-noir-800">
                      {category.name}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-noir-800">
                        {formatBudgetAmount(category.spentAmount)}
                      </span>
                      {category.budgetAmount > 0 && (
                        <span className="text-xs text-taupe-400">
                          / {formatBudgetAmount(category.budgetAmount)}
                        </span>
                      )}
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-taupe-400" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-taupe-400" />
                      )}
                    </div>
                  </div>
                  {category.budgetAmount > 0 && (
                    <div className="mt-1.5 h-1.5 rounded-full bg-ivory-200">
                      <div
                        className={`h-full rounded-full transition-all ${getBarColor(
                          percentage
                        )}`}
                        style={{ width: `${Math.min(percentage, 100)}%` }}
                      />
                    </div>
                  )}
                </div>
              </button>

              {/* 확장 영역: 예산 설정 + 지출 내역 */}
              {isExpanded && (
                <div className="border-t border-platinum p-4">
                  {/* 카테고리 예산 설정 */}
                  <div className="mb-4 flex items-center gap-3">
                    <Input
                      type="number"
                      placeholder="예산 (만원)"
                      value={category.budgetAmount || ""}
                      onChange={(e) =>
                        setCategoryBudget(
                          category.id,
                          parseInt(e.target.value) || 0
                        )
                      }
                      className="w-40"
                    />
                    <span className="text-sm text-taupe-400">만원</span>
                  </div>

                  {/* 지출 내역 */}
                  {category.expenses.length > 0 ? (
                    <div className="space-y-2">
                      <h4 className="text-xs font-medium text-taupe-500 uppercase">
                        지출 내역
                      </h4>
                      {category.expenses.map((expense) => (
                        <div
                          key={expense.id}
                          className="flex items-center justify-between rounded-lg bg-ivory-50 px-3 py-2"
                        >
                          <div>
                            <p className="text-sm text-noir-800">
                              {expense.description}
                            </p>
                            <p className="text-xs text-taupe-400">
                              {expense.date}
                              {expense.vendorName
                                ? ` · ${expense.vendorName}`
                                : ""}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-noir-800">
                              {formatBudgetAmount(expense.amount)}
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteExpense(category.id, expense.id);
                              }}
                              className="rounded p-1 text-taupe-400 hover:bg-ivory-200 hover:text-red-500"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center text-sm text-taupe-400 py-4">
                      아직 지출 내역이 없습니다
                    </p>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* 총 예산 설정 모달 */}
      <Modal
        isOpen={showBudgetModal}
        onClose={() => setShowBudgetModal(false)}
        title="총 예산 설정"
      >
        <div className="space-y-4">
          <Input
            label="총 예산 (만원)"
            type="number"
            value={budgetInput}
            onChange={(e) => setBudgetInput(e.target.value)}
            placeholder="예: 3000"
            helperText="만원 단위로 입력하세요. (예: 3000 = 3천만원)"
          />
          <div className="flex justify-end gap-3">
            <Button
              variant="secondary"
              onClick={() => setShowBudgetModal(false)}
            >
              취소
            </Button>
            <Button onClick={handleSetBudget}>설정</Button>
          </div>
        </div>
      </Modal>

      {/* 지출 추가 모달 */}
      <Modal
        isOpen={showExpenseModal}
        onClose={() => setShowExpenseModal(false)}
        title="지출 추가"
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-noir-800">
              카테고리
            </label>
            <select
              value={selectedCategoryForExpense}
              onChange={(e) =>
                setSelectedCategoryForExpense(e.target.value as CategoryId)
              }
              className="w-full rounded-xl border border-platinum bg-white px-4 py-2.5 text-sm text-noir-800 focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-500/20"
            >
              {CATEGORIES.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.emoji} {cat.name}
                </option>
              ))}
            </select>
          </div>
          <Input
            label="금액 (만원)"
            type="number"
            value={expenseForm.amount}
            onChange={(e) =>
              setExpenseForm({ ...expenseForm, amount: e.target.value })
            }
            placeholder="금액 입력"
          />
          <Input
            label="내용"
            value={expenseForm.description}
            onChange={(e) =>
              setExpenseForm({ ...expenseForm, description: e.target.value })
            }
            placeholder="지출 내용"
          />
          <Input
            label="업체명 (선택)"
            value={expenseForm.vendorName}
            onChange={(e) =>
              setExpenseForm({ ...expenseForm, vendorName: e.target.value })
            }
            placeholder="업체명"
          />
          <div className="flex justify-end gap-3">
            <Button
              variant="secondary"
              onClick={() => setShowExpenseModal(false)}
            >
              취소
            </Button>
            <Button onClick={handleAddExpense}>추가</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
