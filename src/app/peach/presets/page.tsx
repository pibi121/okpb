import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { ensureBuiltinPresets } from "@/lib/ensure-builtin-presets";

export default async function PeachPresetsPage() {
  const user = await requireUser();
  if (!user) return null;

  await ensureBuiltinPresets();

  const presets = await prisma.peachPreset.findMany({
    where: { OR: [{ userId: user.id }, { isBuiltin: true }] },
    orderBy: [{ isBuiltin: "desc" }, { updatedAt: "desc" }],
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-medium">Пресеты</h2>
        <p className="text-sm text-zinc-600">
          Сюда складывай удачные photo/clip/film связки из лаба. Потом они станут
          кнопками для юзеров беты.
        </p>
      </div>

      <ul className="divide-y rounded-lg border border-zinc-200 bg-white">
        {presets.length === 0 ? (
          <li className="p-4 text-sm text-zinc-500">
            Пока пусто — сохрани пресет из вкладок Фото/Видео.
          </li>
        ) : (
          presets.map((p) => (
            <li key={p.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-medium">
                    {p.title}{" "}
                    {p.isBuiltin ? (
                      <span className="text-xs text-rose-700">builtin</span>
                    ) : null}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {p.kind} · {p.slug}
                  </div>
                </div>
              </div>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-zinc-50 p-2 text-xs text-zinc-700">
                {JSON.stringify(JSON.parse(p.payloadJson || "{}"), null, 2)}
              </pre>
              {p.notes ? (
                <p className="mt-1 text-xs text-zinc-500">{p.notes}</p>
              ) : null}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
