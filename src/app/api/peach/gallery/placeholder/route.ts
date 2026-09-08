import { NextResponse } from "next/server";

/** 1×1 dark neutral pixel — used while a gallery job is pending (not green!). */
export async function GET() {
  // Nearly-black opaque pixel so Telegram/miniapps never stretch a loud green square.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYGBQDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  return new NextResponse(png, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
    },
  });
}
