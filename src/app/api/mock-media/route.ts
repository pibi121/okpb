import { NextResponse } from "next/server";

/** Фейковый «медиафайл» — текстовая заглушка вместо настоящего видео. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") || "clip";
  const shot = url.searchParams.get("shot");
  const job = url.searchParams.get("job");

  const text = [
    "peachbitch MOCK MEDIA",
    `kind=${kind}`,
    shot ? `shot=${shot}` : "",
    job ? `job=${job}` : "",
    "",
    "Это заглушка. Настоящее видео появится после подключения GPU (этап C).",
  ]
    .filter(Boolean)
    .join("\n");

  return new NextResponse(text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
