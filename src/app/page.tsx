import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";

export default async function HomePage() {
  const user = await requireUser();
  if (user) redirect("/peach");

  return (
    <div className="relative overflow-hidden py-16 md:py-24">
      <div className="hero-rails" aria-hidden />
      <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-peach">
        Peach lab
      </p>
      <h1 className="font-display text-glow mt-5 max-w-3xl text-5xl leading-[0.95] md:text-7xl">
        Генерация,
        <br />
        которая всегда
        <br />
        под рукой.
      </h1>
      <p className="mt-6 max-w-xl text-lg leading-relaxed text-zinc-500">
        Фото и видео через Krea на Metalnode. Кадры сохраняются локально в
        data/gallery. Пресеты, персонажи, тестер — в одном кабинете.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/register"
          className="rounded-full btn-grad px-6 py-2.5 text-sm font-medium"
        >
          Создать аккаунт
        </Link>
        <Link
          href="/login"
          className="rounded-full border border-white/12 px-6 py-2.5 text-sm text-foreground/80 hover:border-white/25"
        >
          Войти
        </Link>
      </div>
    </div>
  );
}
