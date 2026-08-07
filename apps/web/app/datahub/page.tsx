import Link from "next/link";

/**
 * DataHub placeholder (M6).
 *
 * The architectural decision is already made and recorded here so the shape of
 * the module is not re-litigated later: ALL fetching happens server-side on a
 * schedule, and clients only ever read our own API. See docs/ARCHITECTURE.md.
 */
export default function DataHub() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-300">
        ← 工具庫
      </Link>

      <h1 className="mt-6 text-2xl font-semibold tracking-tight">數據儀表板</h1>
      <p className="mt-2 text-sm text-neutral-500">
        規劃中 — 骨架排在 M6，等寵物攝影機穩定後開工。
      </p>

      <section className="mt-8 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <h2 className="text-sm font-medium">已定案的架構規則</h2>
        <p className="mt-3 text-sm leading-relaxed text-neutral-400">
          所有資料抓取一律在後端（排程 + Function）進行，iOS 與 Web
          只讀自家 API。三個理由：憑證不落在手機上、換裝置不必重新授權、可以留下時序資料畫趨勢圖。
        </p>
      </section>

      <section className="mt-4 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <h2 className="text-sm font-medium">待解問題</h2>
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-neutral-400">
          <li>
            <span className="text-neutral-200">公司 Metabase 的連通性</span> —
            若在 VPN 內，雲端 Function 打不到。可能解法：Metabase public link、
            或在你 Mac 上跑一支定時把結果推上來的 agent。開工前要先確認。
          </li>
          <li>
            <span className="text-neutral-200">外部 API 儀表板</span> —
            排程抓取 + 時序表，這部分沒有障礙。
          </li>
          <li>
            <span className="text-neutral-200">工作／專案數據</span> — 需要
            OAuth 串接，auth 層要先從 pairing code 升級。
          </li>
        </ul>
      </section>
    </main>
  );
}
