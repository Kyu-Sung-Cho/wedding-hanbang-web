export type MessageRole = 'user' | 'assistant' | 'system';
export type MessageSender = 'bride' | 'groom' | 'ai';

export interface ButtonOption {
  value: string;
  label: string;
  desc?: string;
  recommended?: boolean;
}

export interface VendorCard {
  id: string;
  name: string;
  category: string;
  region: string;
  priceRange: string;
  rating: number;
  thumbnailUrl?: string;
  tags?: string[];
}

export interface BudgetOption {
  min: number;
  max: number;
  label: string;
}

export interface EtiquetteCard {
  partId: string;
  title: string;
  description: string;
  icon?: string;
  color?: string;
}

export interface ChecklistCard {
  categoryId: string;
  title: string;
  description: string;
  emoji?: string;
  progress?: number;
}

export interface ToolExecutionResult {
  toolName: string;
  result: { success: boolean; message: string; data?: unknown };
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  sender?: MessageSender;
  buttons?: ButtonOption[];
  vendorCards?: VendorCard[];
  quickReplies?: string[];
  budgetSelector?: { title: string; options: BudgetOption[] };
  toolResults?: ToolExecutionResult[];
  etiquetteCards?: EtiquetteCard[];
  checklistCards?: ChecklistCard[];
  isTyping?: boolean;
}

export interface CategoryBudgetInfo {
  budget: number;
  spent: number;
  remaining: number;
  isOverBudget: boolean;
}

export interface ChatContext {
  coupleId?: string;
  weddingDate?: string;
  role?: 'bride' | 'groom';
  currentCategory?: string;
  budget?: {
    total?: number;
    spent?: number;
    remaining?: number;
    spentPercentage?: number;
    byCategory?: Record<string, CategoryBudgetInfo>;
    overBudgetCategories?: string[];
  };
  completedCategories?: string[];
  inProgressCategories?: string[];
  previousContext?: PreviousConversationContext;
}

export type ChatSummaryType = 'decision' | 'preference' | 'budget' | 'schedule' | 'concern' | 'info' | 'progress';

export interface ChatSummary {
  id: string;
  coupleId: string;
  summaryType: ChatSummaryType;
  categoryId?: string;
  title: string;
  content: string;
  keywords?: string[];
  importance: number;
  isResolved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PreviousConversationContext {
  decisions: ChatSummary[];
  preferences: ChatSummary[];
  concerns: ChatSummary[];
  recentTopics: string[];
}

export interface AIRequest {
  messages: Pick<Message, 'role' | 'content'>[];
  context?: ChatContext;
}

export interface AIResponse {
  content: string;
  buttons?: ButtonOption[];
  vendorCards?: VendorCard[];
  quickReplies?: string[];
  budgetSelector?: { title: string; options: BudgetOption[] };
  toolResults?: ToolExecutionResult[];
  etiquetteCards?: EtiquetteCard[];
  checklistCards?: ChecklistCard[];
}

export const WELCOME_MESSAGE: Message = {
  id: 'welcome',
  role: 'assistant',
  content: '안녕하세요! 👋 저는 웨딩한방 AI 플래너예요.\n\n결혼 준비 뭐든 도와드릴게요! 아래 버튼을 눌러보세요 😊',
  timestamp: new Date().toISOString(),
  buttons: [
    { value: 'venue', label: '🏛️ 웨딩홀/스드메', desc: '업체 추천받기' },
    { value: 'budget', label: '💰 예산 상담', desc: '비용 계획 세우기' },
    { value: 'etiquette', label: '📋 상견례/예절', desc: '예절 가이드' },
    { value: 'schedule', label: '📅 일정 관리', desc: '할 일 체크' },
  ],
  quickReplies: ['진행 상황 보여줘', '뭐부터 해야 해?', '예산 현황', '오늘 할 일'],
};
