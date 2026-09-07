"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { ADMIN_NAV } from "@/lib/peach-nav";

export function PeachLabGuard({
  labAccess,
  children,
}: {
  labAccess: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname() || "";
  const router = useRouter();
  const isLab = ADMIN_NAV.some(
    (l) => pathname === l.href || pathname.startsWith(l.href + "/"),
  );

  useEffect(() => {
    if (isLab && !labAccess) router.replace("/peach");
  }, [isLab, labAccess, router]);

  if (isLab && !labAccess) return null;
  return <>{children}</>;
}
