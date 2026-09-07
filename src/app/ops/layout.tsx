import { OpsShell } from "@/components/ops-shell";

export const dynamic = "force-dynamic";

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return <OpsShell>{children}</OpsShell>;
}
