import { requireUser } from "@/lib/auth";
import { SettingsForm } from "@/components/settings-form";

export default async function PeachSettingsPage() {
  const user = await requireUser();
  if (!user) return null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-medium">Настройки</h2>
        <p className="text-sm text-zinc-500">Имя, аватар и пароль.</p>
      </div>
      <SettingsForm user={{ email: user.email, name: user.name, avatarUrl: user.avatarUrl }} />
    </div>
  );
}
