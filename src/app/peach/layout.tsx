import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PeachSidebar } from "@/components/peach-sidebar";
import { PeachUiModeProvider } from "@/components/peach-ui-mode-provider";
import { PeachLabGuard } from "@/components/peach-lab-guard";
import { labAccess } from "@/lib/ops/roles";

export default async function PeachLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  if (!user) redirect("/login");
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { adminRole: true },
  });
  const canLab = labAccess(row?.adminRole);

  return (
    <PeachUiModeProvider labAccess={canLab}>
      <PeachLabGuard labAccess={canLab}>
        <div className="flex min-h-screen">
          <PeachSidebar
            user={{
              email: user.email,
              name: user.name,
              avatarUrl: user.avatarUrl,
              credits: user.credits,
            }}
          />
          <div className="min-w-0 flex-1">
            <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">{children}</div>
          </div>
        </div>
      </PeachLabGuard>
    </PeachUiModeProvider>
  );
}
