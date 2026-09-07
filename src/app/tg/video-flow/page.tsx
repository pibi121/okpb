"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function Inner() {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    const id = params.get("templateId");
    router.replace(id ? `/tg/video?templateId=${encodeURIComponent(id)}` : "/tg/video");
  }, [params, router]);
  return <p className="tg-loading">…</p>;
}

export default function VideoFlowRedirect() {
  return (
    <Suspense fallback={<p className="tg-loading">…</p>}>
      <Inner />
    </Suspense>
  );
}
