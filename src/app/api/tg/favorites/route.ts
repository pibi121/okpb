import { NextResponse } from "next/server";
import { resolveTgApiUserId } from "@/lib/tg/resolve-api-user";
import {
  listFavoriteCastIds,
  toggleFavoriteCast,
} from "@/lib/tg/cast-favorites";

export async function GET(req: Request) {
  const userId = await resolveTgApiUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ids = await listFavoriteCastIds(userId);
  return NextResponse.json({ favoriteCastIds: ids });
}

export async function POST(req: Request) {
  const userId = await resolveTgApiUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { characterId?: string };
  if (!body.characterId) {
    return NextResponse.json({ error: "characterId required" }, { status: 400 });
  }
  try {
    const result = await toggleFavoriteCast(userId, body.characterId);
    const favoriteCastIds = await listFavoriteCastIds(userId);
    return NextResponse.json({ ...result, favoriteCastIds });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
