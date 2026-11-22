"use client";

import React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface MotionCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Enable hover lift + glow effect */
  hover?: boolean;
}

const MotionCard = React.forwardRef<HTMLDivElement, MotionCardProps>(
  ({ hover = true, children, className, ...props }, ref) => {
    return (
      <motion.div
        whileHover={hover ? { y: -2, transition: { duration: 0.2 } } : undefined}
        whileTap={hover ? { scale: 0.995 } : undefined}
        style={{ height: "100%" }}
      >
        <div
          ref={ref}
          className={cn("glass-card h-full", className)}
          {...props}
        >
          {children}
        </div>
      </motion.div>
    );
  }
);

MotionCard.displayName = "MotionCard";

export default MotionCard;
