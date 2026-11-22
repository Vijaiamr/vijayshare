import { Transaction, SpendingInsight, BudgetRecommendation, DashboardSummary } from './types';

export const SAMPLE_TRANSACTIONS: Transaction[] = [
  { id: 't1', date: '2026-06-01', description: 'Monthly Tech Salary', amount: -165000, categories: ['Income'], recurring: true },
  { id: 't2', date: '2026-06-15', description: 'UI Design Freelance', amount: -35000, categories: ['Income'] },
  { id: 't3', date: '2026-06-02', description: 'Nature Basket Grocery', amount: 4200, categories: ['Food & Dining'] },
  { id: 't4', date: '2026-06-05', description: 'Blue Tokai Coffee', amount: 450, categories: ['Food & Dining'] },
  { id: 't5', date: '2026-06-12', description: 'Sushi Dinner Date', amount: 2200, categories: ['Food & Dining'] },
  { id: 't6', date: '2026-06-18', description: 'Nature Basket Grocery', amount: 3800, categories: ['Food & Dining'] },
  { id: 't7', date: '2026-06-22', description: 'Zomato - Ramen', amount: 1100, categories: ['Food & Dining'] },
  { id: 't8', date: '2026-06-27', description: 'Theobroma Bakery', amount: 600, categories: ['Food & Dining'] },
  { id: 't9', date: '2026-06-03', description: 'Tata Power Electricity', amount: 4500, categories: ['Utilities & Bills'], recurring: true },
  { id: 't10', date: '2026-06-04', description: 'Airtel Broadband Fiber', amount: 1800, categories: ['Utilities & Bills'], recurring: true },
  { id: 't11', date: '2026-06-10', description: 'Jio Mobile Postpaid', amount: 2200, categories: ['Utilities & Bills'], recurring: true },
  { id: 't12', date: '2026-06-05', description: 'Netflix Premium Subscription', amount: 649, categories: ['Entertainment'], recurring: true },
  { id: 't13', date: '2026-06-06', description: 'Spotify Duo Plan', amount: 149, categories: ['Entertainment'], recurring: true },
  { id: 't14', date: '2026-06-14', description: 'PVR INOX Movie Tickets', amount: 850, categories: ['Entertainment'] },
  { id: 't15', date: '2026-06-25', description: 'Steam Games Sale', amount: 2499, categories: ['Entertainment'] },
  { id: 't16', date: '2026-06-08', description: 'Apple Store - Accessories', amount: 11900, categories: ['Shopping'] },
  { id: 't17', date: '2026-06-11', description: 'Amazon.in - Books & Home', amount: 3200, categories: ['Shopping'] },
  { id: 't18', date: '2026-06-20', description: 'Nike Online Store', amount: 8900, categories: ['Shopping'] },
  { id: 't19', date: '2026-06-26', description: 'Zudio Store', amount: 2800, categories: ['Shopping'] },
  { id: 't20', date: '2026-06-07', description: 'HP Petrol Pump', amount: 4500, categories: ['Travel & Transport'] },
  { id: 't21', date: '2026-06-16', description: 'Ola Cab - Airport', amount: 1800, categories: ['Travel & Transport'] },
  { id: 't22', date: '2026-06-19', description: 'HP Petrol Pump', amount: 3800, categories: ['Travel & Transport'] },
  { id: 't23', date: '2026-06-24', description: 'Namma Metro Card Recharge', amount: 300, categories: ['Travel & Transport'] },
  { id: 't24', date: '2026-06-01', description: 'Cult.fit Gym Membership', amount: 5500, categories: ['Health & Wellness'], recurring: true },
  { id: 't25', date: '2026-06-13', description: 'Apollo Pharmacy', amount: 850, categories: ['Health & Wellness'] },
];

export const SAMPLE_INSIGHTS: SpendingInsight[] = [
  {
    id: 'in1', type: 'saving',
    title: 'Subscription Streamlining Opportunity',
    description: 'You have 4 recurring subscription charges this month. Canceling standard service bundles that overlap can save you up to ₹2,500/month.',
    impactValue: '₹2,500/mo saved'
  },
  {
    id: 'in2', type: 'warning',
    title: 'Food & Dining Upward Trend',
    description: 'Dining out and food delivery expenses have increased by 18% compared to last week, driven mostly by Zomato and late-night dine-outs.',
    impactValue: '18% increase'
  },
  {
    id: 'in3', type: 'trend',
    title: 'Solid Net Savings Ratio',
    description: 'Excellent job! You have saved approximately 73% of your freelance and primary tech salary income this month so far.',
    impactValue: '73% Saved'
  },
  {
    id: 'in4', type: 'info',
    title: 'Weekend Spend Pattern',
    description: 'Approximately 62% of your discretionary spending occurs between Friday evening and Sunday night. Consider setting a weekend pocket budget.',
    impactValue: '62% weekend'
  }
];

export const SAMPLE_BUDGETS: BudgetRecommendation[] = [
  { category: 'Food & Dining', suggestedPercentage: 15, limitAmount: 20000, currentSpend: 12350 },
  { category: 'Utilities & Bills', suggestedPercentage: 10, limitAmount: 10000, currentSpend: 8500 },
  { category: 'Entertainment', suggestedPercentage: 8, limitAmount: 8000, currentSpend: 4148 },
  { category: 'Shopping', suggestedPercentage: 12, limitAmount: 30000, currentSpend: 26800 },
  { category: 'Travel & Transport', suggestedPercentage: 8, limitAmount: 15000, currentSpend: 10400 },
  { category: 'Health & Wellness', suggestedPercentage: 7, limitAmount: 10000, currentSpend: 6350 },
];

export const calculateSummary = (transactions: Transaction[]): DashboardSummary => {
  let totalSpent = 0;
  let totalIncome = 0;

  transactions.forEach((t) => {
    if (t.amount > 0) {
      totalSpent += t.amount;
    } else {
      totalIncome += Math.abs(t.amount);
    }
  });

  return {
    totalSpent,
    totalIncome,
    netSavings: totalIncome - totalSpent,
    transactionCount: transactions.length,
  };
};
