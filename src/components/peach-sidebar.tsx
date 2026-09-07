"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "./logout-button";
import { usePeachUiMode } from "./peach-ui-mode-provider";
import { ADMIN_NAV, displayUserName, USER_NAV } from "@/lib/peach-nav";
import { DEFAULT_PLAN_ID, planById } from "@/lib/peach-plans";

type SidebarUser = {
  email: string;
  name: string | null;
  avatarUrl?: string | null;
  credits: number;
};

export function PeachSidebar({ user }: { user: SidebarUser }) {
  const pathname = usePathname() || "/peach";
  const { mode, setMode, isAdmin, labAccess } = usePeachUiMode();
  const plan = planById(DEFAULT_PLAN_ID);
  const nick = displayUserName(user.name, user.email);

  const links = isAdmin ? [...USER_NAV, ...ADMIN_NAV] : USER_NAV;

  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-[232px] shrink-0 flex-col border-r border-white/8 bg-[#0c0c0e]/80 backdrop-blur-md md:flex">
        <Link href="/peach" className="flex items-baseline gap-0.5 px-5 pt-6 pb-5">
          <span className="font-display text-xl leading-none text-grad">peach</span>
          <span className="font-display text-xl leading-none text-foreground/75">bitch</span>
        </Link>

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3">
          {links.map((l) => (
            <NavItem
              key={l.href}
              href={l.href}
              label={l.label}
              active={isActive(pathname, l.href, l.exact)}
            />
          ))}
          {isAdmin ? (
            <p className="mt-3 px-3 text-[10px] uppercase tracking-widest text-zinc-600">
              Lab
            </p>
          ) : null}
        </nav>

        <div className="mt-auto flex flex-col gap-2 border-t border-white/8 px-4 py-4">
          <div className="rounded-xl border border-white/10 bg-[#141416]/90 p-3">
            <div className="flex items-center gap-2">
              {user.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.avatarUrl}
                  alt=""
                  className="h-9 w-9 shrink-0 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-peach/30 to-orange-600/20 text-sm">
                  🍑
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-foreground">{nick}</div>
                <div className="truncate text-[11px] text-zinc-500">{plan.name}</div>
              </div>
              <Link
                href="/peach/settings"
                className="rounded-lg p-1.5 text-zinc-500 hover:bg-white/5 hover:text-foreground"
                title="Настройки"
              >
                <IconGear />
              </Link>
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px]">
              <span className="text-zinc-500">Баланс</span>
              <span className="font-medium text-foreground">{user.credits} кр.</span>
            </div>
            <div className="mt-2 flex flex-col gap-1">
              <Link
                href="/peach/billing"
                className="rounded-lg border border-white/10 py-1.5 text-center text-[11px] text-foreground hover:border-peach/30"
              >
                Изменить тариф
              </Link>
              <Link
                href="/peach/billing#topup"
                className="rounded-lg border border-white/10 py-1.5 text-center text-[11px] text-foreground hover:border-peach/30"
              >
                Пополнить баланс
              </Link>
            </div>
          </div>

          {labAccess ? <UiModeToggle mode={mode} setMode={setMode} /> : null}
          {labAccess ? (
            <Link href="/ops" className="text-center text-[11px] text-peach hover:underline">
              Панель
            </Link>
          ) : null}

          <LogoutButton />
        </div>
      </aside>

      <nav className="sticky top-0 z-40 flex gap-1 overflow-x-auto border-b border-white/8 bg-[#0c0c0e]/85 px-2 py-2 backdrop-blur-md md:hidden">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={
              isActive(pathname, l.href, l.exact)
                ? "shrink-0 rounded-full bg-white/8 px-3 py-1.5 text-xs text-peach"
                : "shrink-0 rounded-full px-3 py-1.5 text-xs text-zinc-500"
            }
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </>
  );
}

function UiModeToggle({
  mode,
  setMode,
}: {
  mode: "user" | "admin";
  setMode: (m: "user" | "admin") => void;
}) {
  return (
    <div className="rounded-xl border border-dashed border-white/12 p-1">
      <button
        type="button"
        onClick={() => setMode("user")}
        className={
          mode === "user"
            ? "w-full rounded-lg bg-white/10 py-1.5 text-[11px] text-foreground"
            : "w-full rounded-lg py-1.5 text-[11px] text-zinc-500 hover:text-foreground"
        }
      >
        Как видит пользователь
      </button>
      <button
        type="button"
        onClick={() => setMode("admin")}
        className={
          mode === "admin"
            ? "mt-0.5 w-full rounded-lg bg-peach/15 py-1.5 text-[11px] text-peach"
            : "mt-0.5 w-full rounded-lg py-1.5 text-[11px] text-zinc-500 hover:text-foreground"
        }
      >
        Как вижу я
      </button>
    </div>
  );
}

function NavItem({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  const item = (
    <Link
      href={href}
      className={
        active
          ? "flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] text-foreground"
          : "flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] text-zinc-500 hover:bg-white/5 hover:text-foreground"
      }
    >
      {label}
    </Link>
  );
  if (active) {
    return (
      <div className="peach-beam peach-beam--inner overflow-hidden rounded-xl">
        <span className="peach-beam-glow" aria-hidden />
        <div className="peach-beam-body bg-[#161618]/90">{item}</div>
      </div>
    );
  }
  return item;
}

function isActive(pathname: string, href: string, exact?: boolean) {
  return exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
}

function IconGear() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M19.4 13a7.8 7.8 0 0 0 .1-2l2-1.2-2-3.4-2.3 1a8 8 0 0 0-1.7-1L15 3h-4l-.5 2.4a8 8 0 0 0-1.7 1l-2.3-1-2 3.4 2 1.2a7.8 7.8 0 0 0 .1 2l-2 1.2 2 3.4 2.3-1a8 8 0 0 0 1.7 1L11 21h4l.5-2.4a8 8 0 0 0 1.7-1l2.3 1 2-3.4-2-1.2Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
