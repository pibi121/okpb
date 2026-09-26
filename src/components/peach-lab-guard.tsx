"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { ALL_LAB_HREFS } from "@/lib/peach-nav";

export function PeachLabGuard({
  labAccess,
  children,
}: {
  labAccess: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname() || "";
  const router = useRouter();
  const isLab = ALL_LAB_HREFS.some(
    (href) => pathname === href || pathname.startsWith(href + "/"),
  );

  useEffect(() => {
    if (isLab && !labAccess) router.replace("/peach");
  }, [isLab, labAccess, router]);

  if (isLab && !labAccess) return null;
  return <>{children}</>;
}
