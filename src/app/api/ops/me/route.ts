import { jsonOk, jsonErr } from "@/lib/ops/http";
import { requireOps } from "@/lib/ops/auth";
import { bootOps } from "@/lib/ops/seed";
import { sectionsFor, roleLabel, labAccess } from "@/lib/ops/roles";

export async function GET() {
  await bootOps();
  const actor = await requireOps();
  if (!actor) return jsonErr("Нет доступа", 401);
  return jsonOk({
    actor: {
      id: actor.id,
      email: actor.email,
      name: actor.name,
      role: actor.adminRole,
      roleLabel: roleLabel(actor.adminRole),
      lab: labAccess(actor.adminRole),
      sections: sectionsFor(actor.adminRole),
    },
  });
}
