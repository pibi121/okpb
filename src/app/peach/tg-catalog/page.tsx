import { TgCatalogAdminClient } from "@/components/tg-catalog-admin-client";

export default function TgCatalogLabPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-medium">Каталог TG-шаблонов</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Все форматы в Mini App и боте: фото, видео и видео по фото. Можно
          скрыть, переименовать или открыть «Редактировать промпт» — сохранить
          обновляет шаблон сразу в TG.
        </p>
      </div>
      <TgCatalogAdminClient />
    </div>
  );
}
