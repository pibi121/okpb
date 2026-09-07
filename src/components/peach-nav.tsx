import Link from "next/link";

const links = [
  { href: "/peach", label: "Обзор", exact: true },
  { href: "/peach/photo", label: "Фото" },
  { href: "/peach/video", label: "Видео" },
  { href: "/peach/gallery", label: "Галерея" },
  { href: "/peach/eros-eval", label: "Eros eval" },
  { href: "/peach/tests", label: "Галерея тестов" },
  { href: "/peach/tester", label: "Тестер" },
  { href: "/peach/characters", label: "Персонажи" },
  { href: "/peach/presets", label: "Пресеты" },
  { href: "/peach/social", label: "Соцсети" },
];

export function PeachNav({ pathname }: { pathname: string }) {
  return (
    <nav className="flex flex-wrap gap-x-1 border-b border-white/8">
      {links.map((l) => {
        const active = l.exact
          ? pathname === l.href
          : pathname === l.href || pathname.startsWith(l.href + "/");
        return (
          <Link
            key={l.href}
            href={l.href}
            className={
              active
                ? "-mb-px border-b border-peach px-3 py-2.5 text-sm text-peach"
                : "-mb-px border-b border-transparent px-3 py-2.5 text-sm text-zinc-500 hover:text-foreground"
            }
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
