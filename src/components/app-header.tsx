import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { LogoutButton } from "./logout-button";

export async function AppHeader() {
  const user = await requireUser();

  return (
    <header className="sticky top-0 z-40 border-b border-white/8 bg-[#0f0f10]/75 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5">
        <Link href={user ? "/peach" : "/"} className="flex items-baseline gap-0.5">
          <span className="font-display text-[1.35rem] leading-none text-grad">
            peach
          </span>
          <span className="font-display text-[1.35rem] leading-none text-foreground/80">
            bitch
          </span>
        </Link>
        <nav className="flex flex-wrap items-center gap-5 text-[13px] text-zinc-500">
          {user ? (
            <>
              <Link href="/peach" className="hover:text-foreground">
                Peach
              </Link>
              <Link href="/peach/gallery" className="hover:text-foreground">
                Галерея
              </Link>
              <Link href="/peach/presets" className="hover:text-foreground">
                Пресеты
              </Link>
              <Link
                href="/scenarios"
                className="text-zinc-400/70 hover:text-zinc-500"
                title="BITCH lab (позже)"
              >
                BITCH
              </Link>
              <span className="rounded-full border border-white/10 px-3 py-1 text-foreground/90">
                {user.credits} кр.
              </span>
              <LogoutButton />
            </>
          ) : (
            <>
              <Link href="/login" className="hover:text-foreground">
                Вход
              </Link>
              <Link
                href="/register"
                className="rounded-full btn-grad px-3.5 py-1.5 text-[13px] hover:brightness-110"
              >
                Регистрация
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
