export interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: number; // positive = expense, negative = income
  categories: string[];
  recurring?: boolean;
  confidence?: 'high' | 'medium' | 'low';
  matchedKeywords?: Record<string, string>;
  learned?: boolean;
  payee?: string;
  rawCategory?: string;
}

export interface SpendingInsight {
  id: string;
  type: 'saving' | 'warning' | 'trend' | 'info';
  /** What happened — e.g. "Shopping Over Budget" */
  title: string;
  /** Why it matters — e.g. "₹10,291 spent against a ₹6,815 monthly budget (151%)." */
  description: string;
  /** Recommended action — e.g. "Reduce discretionary shopping by ₹3,497." */
  recommendation?: string;
  impactValue?: string;
  /** When set, the insight card renders a [Review Transactions] action. */
  action?: 'review';
}

export interface BudgetRecommendation {
  category: string;
  suggestedPercentage: number;
  limitAmount: number;
  currentSpend?: number;
}

export interface DashboardSummary {
  totalSpent: number;
  totalIncome: number;
  netSavings: number;
  transactionCount: number;
}

export const DEFAULT_CATEGORIES = [
  'Income',
  'Food & Dining',
  'Utilities & Bills',
  'Entertainment',
  'Shopping',
  'Travel & Transport',
  'Health & Wellness',
  'Commitment',
  'Loan',
  'ATM',
  'Investment',
  'Others',
];
