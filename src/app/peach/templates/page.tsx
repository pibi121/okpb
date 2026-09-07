import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listTemplatePacks } from "@/lib/template-pack";
import { listUserRuns } from "@/lib/template-play";
import { TemplateFolderCreate } from "@/components/template-folder-create";
import { TemplateUseButton } from "@/components/template-use-button";

export default async function PeachTemplatesPage() {
  const user = await requireUser();
  if (!user) return null;
  const [packs, runs] = await Promise.all([
    listTemplatePacks(user.id),
    listUserRuns(user.id),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6">
      <div>
        <h2 className="text-lg font-medium">Шаблоны</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Автор собирает папку и публикует карточку. Пользователь идёт по шагам: шаблон → персонажи
          → сцены → комментарии и диалоги.
        </p>
      </div>

      <TemplateFolderCreate />

      {runs.length > 0 ? (
        <section className="space-y-3">
          <h3 className="text-sm font-medium text-zinc-400">Прогоны как пользователь</h3>
          <ul className="space-y-2">
            {runs.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/peach/play/${r.id}`}
                  className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 hover:border-white/20"
                >
                  <div>
                    <p className="text-sm font-medium">{r.packTitle}</p>
                    <p className="text-xs text-zinc-500">
                      {r.step === "characters"
                        ? "выбор персонажей"
                        : r.step === "stills"
                          ? "сцены"
                          : r.step === "animate"
                            ? "оживление"
                            : "готово"}{" "}
                      · {r.frameCount} кадров
                    </p>
                  </div>
                  <span className="text-xs text-peach">продолжить</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-3">
        <h3 className="text-sm font-medium text-zinc-400">Твои папки</h3>
        {packs.length === 0 ? (
          <p className="text-sm text-zinc-600">Пока пусто — создай первую папку выше.</p>
        ) : (
          <ul className="space-y-2">
            {packs.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3"
              >
                <Link href={`/peach/templates/${p.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                  {p.coverStillUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.coverStillUrl}
                      alt=""
                      className="h-12 w-9 rounded object-cover bg-zinc-800"
                    />
                  ) : (
                    <div className="h-12 w-9 rounded bg-zinc-800" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.title}</p>
                    <p className="text-xs text-zinc-500">
                      {p.status === "published" ? "готовый шаблон" : "сборка"} · {p.approvedCount}/
                      {p.frameCount} кадров
                      {p.characterSlots.length
                        ? ` · ${p.characterSlots
                            .map((s, i) => `${i + 1}. ${s.name}`)
                            .join(" / ")}`
                        : ""}
                    </p>
                  </div>
                </Link>
                {p.frameCount > 0 ? (
                  <TemplateUseButton packId={p.id} label="Использовать" />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
