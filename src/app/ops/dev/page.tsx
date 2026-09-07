import Link from "next/link";
import { ADMIN_NAV } from "@/lib/peach-nav";

export default function OpsDevPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-3xl">Разработка</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Это та же лаборатория, что была на Railway: шаблоны, персонажи, тесты. Обычные люди сюда не попадают.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {ADMIN_NAV.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="rounded-2xl border border-white/10 px-4 py-3 text-sm hover:border-peach/40"
          >
            {l.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
