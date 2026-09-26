import type { MetadataRoute } from "next";
import { DEFAULT_THEME_COLOR } from "@/lib/theme";
import { withBasePath } from "@/lib/base-path";

/**
 * Web App Manifest：讓 iPhone「加入主畫面」與未來的 App 外殼拿到名稱、
 * 圖示與起始頁。start_url 直接進「所有婚宴」，未登入會被導向登入頁。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "誓約簿 VowBook",
    short_name: "誓約簿",
    description: "讓伴侶與婚顧在同一個安心、清楚的空間，共同整理婚宴的重要決定。",
    lang: "zh-Hant",
    start_url: withBasePath("/dashboard"),
    scope: withBasePath("/"),
    display: "standalone",
    orientation: "portrait",
    background_color: DEFAULT_THEME_COLOR,
    theme_color: DEFAULT_THEME_COLOR,
    icons: [
      {
        src: withBasePath("/icon.png"),
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: withBasePath("/apple-icon.png"),
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
