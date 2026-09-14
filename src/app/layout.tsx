import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AuthSessionProvider } from "@/components/auth/auth-session-provider";
import { ThemeController } from "@/components/theme/theme-controller";
import { DEFAULT_THEME_COLOR, THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "誓約簿 VowBook｜一起把婚宴好好完成",
    template: "%s｜誓約簿 VowBook",
  },
  description:
    "讓伴侶與婚顧在同一個安心、清楚的空間，共同整理婚宴的重要決定。",
  applicationName: "誓約簿 VowBook",
  // 加入 iPhone 主畫面後以全螢幕 App 外殼開啟；狀態列沿用頁面底色。
  appleWebApp: {
    capable: true,
    title: "誓約簿",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 讓版面延伸到瀏海與 Home 指示條下方，再由 safe-area-inset 各自留白。
  viewportFit: "cover",
  themeColor: DEFAULT_THEME_COLOR,
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
