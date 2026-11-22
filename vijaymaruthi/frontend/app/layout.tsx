import type { Metadata } from "next";
import Script from "next/script";
import { Inter, JetBrains_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  title: "VijayMaruthi Wealth Platform",
  description: "Institutional-grade analysis for NSE stocks",
};

/**
 * Root layout — no MUI providers.
 * Dark mode is handled via Tailwind's `dark` class on <html>,
 * toggled by ThemeSwitcher which reads/writes localStorage("qm-theme").
 * A small inline script reads localStorage before paint to prevent flash.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        {/* Prevent flash of wrong theme — reads localStorage before paint.
            next/script (beforeInteractive) injects this outside React's
            render tree, avoiding the "script tag inside React component"
            hydration warning. */}
        <Script id="theme-init" strategy="beforeInteractive">
          {`(function(){try{var t=localStorage.getItem('qm-theme');if(t==='light'){document.documentElement.classList.remove('dark')}else{document.documentElement.classList.add('dark')}}catch(e){document.documentElement.classList.add('dark')}})()`}
        </Script>
        <link rel="icon" href="/favicon.png" type="image/png" />
      </head>
      <body className="min-h-screen bg-background font-sans antialiased">
        <TooltipProvider delay={300}>
          {children}
        </TooltipProvider>
        <Toaster
          position="bottom-right"
          toastOptions={{
            className: "glass-card",
          }}
        />
      </body>
    </html>
  );
}
