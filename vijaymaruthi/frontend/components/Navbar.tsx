"use client";

import Link from "next/link";
import { BarChart3, TrendingUp } from "lucide-react";

export default function Navbar() {
  return (
    <nav className="glass border-b border-white/10">
      <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-14">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 text-white font-semibold">
          <BarChart3 className="w-5 h-5 text-[#56d364]" />
          <span>VijayMaruthi Wealth</span>
        </Link>

        {/* Navigation — clean, no ticker search */}
        <div className="flex items-center gap-6 text-sm">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-[#8b949e] hover:text-white transition-colors"
          >
            <TrendingUp className="w-4 h-4" />
            Stock List
          </Link>

          <span className="text-[#8b949e] text-xs font-mono">
            NSE · BSE · US
          </span>
        </div>
      </div>
    </nav>
  );
}
