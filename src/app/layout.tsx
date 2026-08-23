import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AuthSessionProvider } from "@/components/auth/auth-session-provider";
import { ThemeController } from "@/components/theme/theme-controller";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "誓約簿 VowBook｜一起把婚宴好好完成",
    template: "%s｜誓約簿 VowBook",
  },
  description:
    "讓伴侶與婚顧在同一個安心、清楚的空間，共同整理婚宴的重要決定。",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-Hant" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body>
        <ThemeController />
        <AuthSessionProvider>{children}</AuthSessionProvider>
      </body>
    </html>
  );
}
