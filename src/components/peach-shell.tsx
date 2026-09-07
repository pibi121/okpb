import { PeachUiModeProvider } from "@/components/peach-ui-mode-provider";

export function PeachShell({
  user,
  children,
}: {
  user: { email: string; name: string | null; credits: number };
  children: React.ReactNode;
}) {
  return <PeachUiModeProvider>{children}</PeachUiModeProvider>;
}
