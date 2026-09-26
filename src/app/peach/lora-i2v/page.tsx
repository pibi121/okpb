import { Suspense } from "react";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { LoraI2vLabClient } from "@/components/lora-i2v-lab-client";

export default async function LoraI2vLabPage() {
  const user = await requireUser();
  if (!user) return null;

  const characters = await prisma.character.findMany({
    where: {
      OR: [
        { userId: user.id },
        { isStudioCast: true, loraStatus: "lora_ready" },
      ],
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      loraStatus: true,
      triggerWord: true,
      isStudioCast: true,
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-medium">Сюжет / диалоги · видео по 1 фото</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Lab 2.0: фото → Identity Edit still → I2V по шотам → шаблон с кнопкой,
          категорией 🍓🍿💬 и тизером. Legacy LoRA — переключателем в форме.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-zinc-500">…</p>}>
        <LoraI2vLabClient characters={characters} />
      </Suspense>
    </div>
  );
}
