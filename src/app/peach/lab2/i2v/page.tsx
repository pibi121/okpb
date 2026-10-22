import { requireUser } from "@/lib/auth";
import { Lab2I2vClient } from "@/components/lab2-i2v-client";

export default async function Lab2I2vPage() {
  const user = await requireUser();
  if (!user) return null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-[11px] uppercase tracking-widest text-peach/80">
          Лаборатория 2.0
        </p>
        <h1 className="mt-1 text-lg font-medium">I2V с моего фото</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-500">
          Фото становится первым кадром видео. Промпт описывает движение.
          В шаблон и в бота это не уходит — ролик остаётся в галерее.
        </p>
      </div>
      <Lab2I2vClient />
    </div>
  );
}
