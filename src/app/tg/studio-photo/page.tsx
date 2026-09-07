"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function Inner() {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    const q = new URLSearchParams();
    const templateId = params.get("templateId");
    const castId = params.get("castId");
    if (templateId) q.set("templateId", templateId);
    if (castId) q.set("castId", castId);
    const s = q.toString();
    router.replace(s ? `/tg/photo?${s}` : "/tg/photo");
  }, [params, router]);
  return <p className="tg-loading">…</p>;
}

export default function StudioPhotoRedirect() {
  return (
    <Suspense fallback={<p className="tg-loading">…</p>}>
      <Inner />
    </Suspense>
  );
}
