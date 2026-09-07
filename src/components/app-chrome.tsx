"use client";

import { usePathname } from "next/navigation";

export function AppChrome({
  header,
  children,
}: {
  header: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname() || "";
  const bare =
    pathname.startsWith("/peach") ||
    pathname.startsWith("/tg") ||
    pathname.startsWith("/ops");

  if (bare) {
    return <div className="min-h-full">{children}</div>;
  }

  return (
    <>
      {header}
      <main className="mx-auto max-w-6xl flex-1 px-4 py-10">{children}</main>
    </>
  );
}
