"use client";

import Link from "next/link";
import { useState } from "react";

type Badge = "free" | "juice" | "peach" | "bitch";

const BADGE: Record<Badge, { label: string; className: string }> = {
  free: { label: "Free", className: "bg-emerald-500/15 text-emerald-300" },
  juice: { label: "JUICE", className: "bg-amber-500/20 text-amber-200" },
  peach: { label: "Peach", className: "bg-peach/15 text-peach" },
  bitch: { label: "Bitch", className: "bg-fuchsia-500/15 text-fuchsia-200" },
};

export function MarketplaceCard({
  title,
  description,
  previewImage,
  previewVideo,
  badge = "free",
  href,
  onUse,
  useLabel = "Использовать шаблон",
}: {
  title: string;
  description?: string;
  previewImage?: string;
  previewVideo?: string;
  badge?: Badge;
  href?: string;
  onUse?: () => void;
  useLabel?: string;
}) {
  const [hover, setHover] = useState(false);
  const b = BADGE[badge];

  const inner = (
    <article
      className="group relative overflow-hidden rounded-2xl border border-white/10 bg-[#121214] transition hover:border-white/20"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="relative aspect-[9/16] max-h-[280px] w-full overflow-hidden bg-gradient-to-br from-[#1a1218] via-[#141416] to-[#101820]">
        {previewVideo ? (
          <video
            src={previewVideo}
            poster={previewImage || undefined}
            className="h-full w-full object-cover"
            autoPlay={hover}
            muted
            loop
            playsInline
            preload="metadata"
          />
        ) : previewImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewImage}
            alt=""
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="h-16 w-16 rounded-full bg-peach/10 animate-pulse" />
          </div>
        )}
        <span
          className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${b.className}`}
        >
          {b.label}
        </span>
        <div
          className={`absolute inset-0 flex items-end justify-center bg-gradient-to-t from-black/70 via-black/20 to-transparent p-4 transition ${hover ? "opacity-100" : "opacity-0"}`}
        >
          {href ? (
            <span className="rounded-full bg-peach px-4 py-2 text-xs font-medium text-black">
              {useLabel}
            </span>
          ) : onUse ? (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                onUse();
              }}
              className="rounded-full bg-peach px-4 py-2 text-xs font-medium text-black"
            >
              {useLabel}
            </button>
          ) : null}
        </div>
      </div>
      <div className="p-3">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {description ? (
          <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{description}</p>
        ) : null}
      </div>
    </article>
  );

  if (href) {
    return (
      <Link href={href} className="block">
        {inner}
      </Link>
    );
  }
  return inner;
}

export function OverviewCtaCard({
  title,
  body,
  href,
  cta,
  accent = "peach",
}: {
  title: string;
  body: string;
  href: string;
  cta: string;
  accent?: "peach" | "violet" | "sky";
}) {
  const grad =
    accent === "violet"
      ? "from-violet-500/20 via-[#161618] to-[#121214]"
      : accent === "sky"
        ? "from-sky-500/15 via-[#161618] to-[#121214]"
        : "from-peach/20 via-[#161618] to-[#121214]";

  return (
    <Link
      href={href}
      className={`group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br ${grad} p-5 transition hover:border-white/20`}
    >
      <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-peach/10 blur-2xl transition group-hover:scale-125" />
      <h3 className="relative font-medium text-foreground">{title}</h3>
      <p className="relative mt-2 text-sm leading-relaxed text-zinc-500">{body}</p>
      <span className="relative mt-4 inline-flex rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-foreground transition group-hover:border-peach/40 group-hover:text-peach">
        {cta}
      </span>
    </Link>
  );
}
