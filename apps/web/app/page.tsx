import Link from "next/link";
import { MODULES, STATUS_LABEL } from "@/lib/modules";

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <header className="mb-10">
        <h1 className="text-2xl font-semibold tracking-tight">All-in-One</h1>
        <p className="mt-1 text-sm text-neutral-500">個人化工具庫</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {MODULES.map((m) => (
          <Link
            key={m.id}
            href={m.href}
            className="group rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5 transition-colors hover:border-neutral-600"
          >
            <div className="flex items-start justify-between">
              <span className="text-2xl">{m.glyph}</span>
              <span className="rounded-full border border-[var(--color-line)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500">
                {STATUS_LABEL[m.status]}
              </span>
            </div>
            <h2 className="mt-4 font-medium">{m.title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-neutral-500">
              {m.subtitle}
            </p>
          </Link>
        ))}
      </div>

      <p className="mt-10 text-xs leading-relaxed text-neutral-600">
        新增工具只需在{" "}
        <code className="text-neutral-500">lib/modules.ts</code> 加一筆並建立對應
        route，外殼與導覽不需改動。
      </p>
    </main>
  );
}
