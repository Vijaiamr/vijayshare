/**
 * Merchant display helpers for the ledger — client-safe pure functions.
 *
 * Bank/UPI statements carry noisy raw descriptions (e.g.
 * "UPI-LULU COIMBATORE-LULUCOIMBATORE@YBL-YESB0YBLUPI-877098478181-PAYMENT FOR 191498").
 * These helpers turn that into a clean, readable merchant line:
 *
 *   name: "Lulu Hypermarket"
 *   meta: "UPI · Coimbatore"
 *
 * The raw description is always preserved on the Transaction and shown in the
 * detail drawer — we never mutate the source data.
 */

import type { Transaction } from "./types";

// ── Canonical merchant names ───────────────────────────────────────────────
// Small, safe alias map for well-known chains. Unknown merchants fall back to
// a title-cased version of the raw UPI merchant segment.
const MERCHANT_ALIASES: Record<string, string> = {
  "LULU COIMBATORE": "Lulu Hypermarket",
  "LULU": "Lulu Hypermarket",
  "AMAZON": "Amazon",
  "FLIPKART": "Flipkart",
  "SWIGGY": "Swiggy",
  "ZOMATO": "Zomato",
  "BIGBASKET": "BigBasket",
  "DMART": "DMart",
  "RELIANCE FRESH": "Reliance Fresh",
  "RELIANCE": "Reliance",
  "JIO": "Jio",
  "AIRTEL": "Airtel",
  "NETFLIX": "Netflix",
  "SPOTIFY": "Spotify",
  "PVR": "PVR INOX",
  "APOLLO": "Apollo Pharmacy",
  "CULT": "Cult.fit",
  "HP": "HP Petrol Pump",
  "INDIAN OIL": "Indian Oil",
  "BPCL": "BPCL",
  "TATA POWER": "Tata Power",
  "TATA": "Tata",
  "OLA": "Ola",
  "UBER": "Uber",
  "IRCTC": "IRCTC",
  "PAYTM": "Paytm",
  "PHONEPE": "PhonePe",
  "GOOGLE PAY": "Google Pay",
  "NATURE BASKET": "Nature Basket",
  "BLUE TOKAI": "Blue Tokai",
  "THEOBROMA": "Theobroma",
  "ZUDIO": "Zudio",
  "NIKE": "Nike",
  "STEAM": "Steam",
  "PVR INOX": "PVR INOX",
  "SBI": "SBI",
  "HDFC": "HDFC Bank",
  "ICICI": "ICICI Bank",
};

// Major Indian cities used to derive the "· City" suffix from UPI merchant
// names (e.g. "LULU COIMBATORE" → "UPI · Coimbatore").
const CITY_NAMES = [
  "COIMBATORE", "CHENNAI", "BENGALURU", "BANGALORE", "MUMBAI", "DELHI",
  "HYDERABAD", "PUNE", "KOCHI", "KOLKATA", "AHMEDABAD", "JAIPUR", "LUCKNOW",
  "SURAT", "NAGPUR", "INDORE", "THANE", "BHOPAL", "VISAKHAPATNAM", "PATNA",
  "VADODARA", "GHAZIABAD", "LUDHIANA", "AGRA", "NASHIK", "FARIDABAD",
  "MEERUT", "RAJKOT", "VARANASI", "SRINAGAR", "AURANGABAD", "DHANBAD",
  "AMRITSAR", "NAVI MUMBAI", "RANCHI", "HOWRAH", "MADURAI", "MYSORE",
  "MYSURU", "GURGAON", "NOIDA", "VIJAYAWADA", "JAMSHEDPUR", "RAIPUR",
  "GUWAHATI", "CHANDIGARH", "SOLAPUR", "HUBLI", "TRICHY", "KANPUR",
  "SALEM", "ERODE", "TIRUPPUR", "THRISSUR", "KOZHIKODE", "MANGALURU",
  "MANGALORE", "UDUPI", "BELGAUM", "TIRUPATI", "GUNTUR", "KAKINADA",
  "NELLORE", "KURNOOL", "RAJAHMUNDRY", "KOLAR", "HASSAN", "MANDYA",
  "SHIVAMOGGA", "DAVANGERE", "TUMKUR", "BELLARY", "BIDAR", "GULBARGA",
  "KANNUR", "PALAKKAD", "KOLLAM", "KOTTAYAM", "ERNAKULAM", "MALAPPURAM",
  "KASARAGOD", "ALAPPUZHA", "PATHANAMTHITTA", "WAYANAD", "IDUKKI",
];

export function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length <= 2 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

// ── Payment method ─────────────────────────────────────────────────────────

export function detectPaymentMethod(description: string): string {
  const d = description.toUpperCase();
  if (d.includes("UPI")) return "UPI";
  if (d.includes("PAYTM")) return "Paytm";
  if (d.includes("PHONEPE")) return "PhonePe";
  if (d.includes("GOOGLE PAY") || d.includes("GPAY")) return "Google Pay";
  if (d.includes("NEFT")) return "NEFT";
  if (d.includes("IMPS")) return "IMPS";
  if (d.includes("RTGS")) return "RTGS";
  if (d.includes("POS")) return "Card (POS)";
  if (d.includes("ATM")) return "ATM";
  if (d.includes("CHEQUE")) return "Cheque";
  if (d.includes("CARD")) return "Card";
  return "Bank";
}

// ── Merchant normalization ─────────────────────────────────────────────────

export interface MerchantDisplay {
  /** Clean merchant name, e.g. "Lulu Hypermarket" */
  name: string;
  /** Secondary line, e.g. "UPI · Coimbatore" */
  meta: string;
}

/**
 * Normalize a transaction's raw description into a readable merchant line.
 * UPI statements follow "UPI-MERCHANT-MERCHANTID@BANK-REF-..."; we take the
 * merchant segment, apply the canonical alias map, and derive the city.
 */
export function normalizeMerchant(tx: Transaction): MerchantDisplay {
  const desc = tx.description || "";
  const upper = desc.toUpperCase();

  // UPI format: UPI-MERCHANT NAME-MERCHANTID@BANK-...
  // Greedy [^-]+ captures the full merchant segment ("LULU COIMBATORE") so the
  // city suffix can be derived; lazy matching would stop at the first hyphen.
  const upiMatch = desc.match(/^UPI[- ]([^-]+)(?:[- ]|$)/i);
  if (upiMatch) {
    const raw = upiMatch[1].trim().toUpperCase();
    const alias = MERCHANT_ALIASES[raw] || MERCHANT_ALIASES[raw.split(" ")[0]] || titleCase(raw);
    const city = CITY_NAMES.find((c) => raw.includes(c));
    return { name: alias, meta: `UPI${city ? ` · ${titleCase(city)}` : ""}` };
  }

  // Non-UPI: fall back to the stored payee key, else the raw description.
  if (tx.payee) {
    const p = tx.payee;
    const city = CITY_NAMES.find((c) => p.toUpperCase().includes(c));
    const words = p.split(/\s+/).filter(Boolean);
    const name = titleCase(words.slice(0, 3).join(" ")) || desc;
    return { name, meta: city ? `UPI · ${titleCase(city)}` : detectPaymentMethod(desc) };
  }

  return { name: desc, meta: detectPaymentMethod(desc) };
}

// ── Compact Indian currency formatting ─────────────────────────────────────

/**
 * "₹1.43L" style compact formatting for chart center metrics.
 * 142709 → "₹1.43L", 8500 → "₹8.5K", 450 → "₹450".
 */
export function formatCompactLakh(value: number): string {
  const lakhs = value / 100000;
  if (lakhs >= 1) return `₹${lakhs.toFixed(2)}L`;
  const thousands = value / 1000;
  if (thousands >= 1) return `₹${thousands.toFixed(1)}K`;
  return `₹${Math.round(value)}`;
}

/** "31 Jul 2026" style date formatting (UTC-safe for YYYY-MM-DD strings). */
export function formatDisplayDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}