"use client";

import Link from "next/link";
import { usePeachUiMode } from "@/components/peach-ui-mode-provider";
import { OverviewCtaCard } from "@/components/marketplace-card";
import { BorderBeam } from "@/components/border-beam";

type AdminStats = {
  chars: number;
  gallery: number;
  presets: number;
};

export function PeachHomeClient({ stats }: { stats: AdminStats }) {
  const { isAdmin } = usePeachUiMode();

  if (isAdmin) {
    return <AdminDashboard stats={stats} />;
  }

  return <UserHome />;
}

function UserHome() {
  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="font-display text-glow text-3xl md:text-4xl">Добро пожаловать в PeachBitch!</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-500">
          Здесь твои фантазии станут реальными образами. Ты можешь создавать фото, видео и
          фильмы с нуля, а можешь воспользоваться готовыми шаблонами.
        </p>
      </div>

      <section>
        <h2 className="text-[11px] font-medium uppercase tracking-[0.28em] text-peach">
          С чего начать
        </h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <OverviewCtaCard
            title="Создать персонажа"
            body="Загрузи фотографии персонажа, чью внешность хочешь перенести, или опиши своего героя текстом."
            href="/peach/characters"
            cta="Создать персонажа"
            accent="peach"
          />
          <OverviewCtaCard
            title="Библиотека персонажей"
            body="Выбери готового персонажа — бесплатно или с пометкой JUICE — добавь в свой список и начни генерации."
            href="/peach/characters/library"
            cta="Выбрать готового персонажа"
            accent="violet"
          />
        </div>
      </section>

      <section>
        <h2 className="text-[11px] font-medium uppercase tracking-[0.28em] text-peach">
          Фантазируй по-крупному
        </h2>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <OverviewCtaCard
            title="Сгенерировать фотографию"
            body="Помести персонажа в любую локацию, выбери стиль и действие — потом преврати кадр в видео."
            href="/peach/photo"
            cta="Генерация фото"
            accent="sky"
          />
          <OverviewCtaCard
            title="Сгенерировать видео"
            body="Создай видео или целый фильм со своими персонажами — готовые блоки и твои комментарии."
            href="/peach/video"
            cta="Генерация видео"
            accent="peach"
          />
          <OverviewCtaCard
            title="Использовать шаблон"
            body="Бесплатные шаблоны или JUICE — готовое видео в пару кликов."
            href="/peach/video?tab=peach"
            cta="Использовать шаблон"
            accent="violet"
          />
        </div>
      </section>
    </div>
  );
}

function AdminDashboard({ stats }: { stats: AdminStats }) {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-peach">Peach lab</p>
        <h1 className="font-display text-glow mt-2 text-4xl md:text-5xl">Кабинет (dev)</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Режим «Как вижу я» — все lab-разделы в меню слева.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat title="Персонажи" value={stats.chars} href="/peach/characters" />
        <Stat title="Галерея" value={stats.gallery} href="/peach/gallery" />
        <Stat title="Пресеты" value={stats.presets} href="/peach/presets" />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Quick title="Фото" body="Генератор still." href="/peach/photo" pulse />
        <Quick title="Видео (hub)" body="User-facing video hub." href="/peach/video" />
        <Quick title="Pose eval" body="Ref2V оценка кирпичей." href="/peach/pose-eval" />
        <Quick title="Eros eval" body="Classroom + Park." href="/peach/eros-eval" />
        <Quick title="Тестер" body="Seed + оценки." href="/peach/tester" />
        <Quick title="Video legacy" body="Старый мини-фильм." href="/peach/video/legacy" />
      </div>

      <div className="rounded-2xl border border-dashed border-white/12 bg-white/5 p-5 text-sm text-zinc-500">
        <p className="font-medium text-foreground">BITCH (блок-схема)</p>
        <p className="mt-1">
          Старый конструктор:{" "}
          <Link href="/scenarios" className="text-peach hover:underline">
            /scenarios
          </Link>
        </p>
      </div>
    </div>
  );
}

function Stat({ title, value, href }: { title: string; value: number; href: string }) {
  return (
    <Link
      href={href}
      className="rounded-2xl border border-white/8 bg-white p-5 transition-colors hover:border-white/16"
    >
      <div className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">{title}</div>
      <div className="font-display mt-2 text-3xl font-medium tracking-tight text-grad">{value}</div>
    </Link>
  );
}

function Quick({
  title,
  body,
  href,
  pulse,
}: {
  title: string;
  body: string;
  href: string;
  pulse?: boolean;
}) {
  const inner = (
    <Link href={href} className="block rounded-2xl bg-white p-5">
      <div className="font-medium">{title}</div>
      <p className="mt-1.5 text-sm text-zinc-500">{body}</p>
    </Link>
  );
  if (pulse) return <BorderBeam>{inner}</BorderBeam>;
  return (
    <div className="rounded-2xl border border-white/8 transition-colors hover:border-white/16">
      {inner}
    </div>
  );
}
