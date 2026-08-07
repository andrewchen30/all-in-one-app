/**
 * The tool registry.
 *
 * Mirrors `ToolModule` on the iOS side (apps/ios/Sources/Core/ModuleRegistry).
 * Adding a tool should mean adding one entry here and one route — never
 * touching shell or navigation code.
 */
export interface ToolModule {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  /** Emoji stands in for the SF Symbol used by the iOS shell. */
  glyph: string;
  status: "ready" | "wip" | "planned";
}

export const MODULES: ToolModule[] = [
  {
    id: "petcam",
    title: "寵物攝影機",
    subtitle: "把舊 iPhone 變成即時監看鏡頭",
    href: "/petcam",
    glyph: "🐾",
    status: "wip",
  },
  {
    id: "datahub",
    title: "數據儀表板",
    subtitle: "Metabase 報表與外部 API 數字",
    href: "/datahub",
    glyph: "📊",
    status: "planned",
  },
];

export const STATUS_LABEL: Record<ToolModule["status"], string> = {
  ready: "可用",
  wip: "開發中",
  planned: "規劃中",
};
