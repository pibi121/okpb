import { requireUser } from "@/lib/auth";
import { TeaseLabClient } from "@/components/tease-lab-client";

export default async function TeaseLabPage() {
  const user = await requireUser();
  if (!user) return null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-medium">Tease Lab</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Превью для TG без баланса: blur + PNG по центру. Крути ползунки →
          сохрани пресет → потом подключим к undress.
        </p>
      </div>
      <TeaseLabClient />
    </div>
  );
}
