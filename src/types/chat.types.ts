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
  rating: number | null;
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

export interface UrgentCategory {
  id: string;
  name: string;
  emoji: string;
  status: string;
  progress: string;
  latestDaysBefore: number;
  isOverdue: boolean;
  estimatedCost: string;
  nextUncheckedItem?: string;
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
  urgentCategories?: UrgentCategory[];
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
  content: '안녕하세요! 👋 저는 웨딩한방 AI 플래너예요.\n\n함께 최고의 웨딩을 만들어볼까요? ✨\n먼저 어떤 분위기의 결혼식을 꿈꾸고 계신지 궁금해요!',
  timestamp: new Date().toISOString(),
  sender: 'ai',
  buttons: [
    { value: '모던하고 세련된 웨딩이 좋아요', label: '🖤 모던·세련', desc: '심플하고 도시적인 느낌', recommended: true },
    { value: '따뜻하고 클래식한 웨딩이 좋아요', label: '🌹 클래식·로맨틱', desc: '우아하고 전통적인 느낌' },
    { value: '자연스럽고 편안한 야외 웨딩이 좋아요', label: '🌿 내추럴·가든', desc: '야외 또는 자연 느낌' },
    { value: '아직 잘 모르겠어요. 추천해주세요', label: '💡 추천해주세요', desc: '취향 파악부터 도와드릴게요' },
  ],
  quickReplies: ['뭐부터 해야 해?', '예산 상담', '진행 상황 보여줘', '스드메 알아보기'],
};
