/**
 * Sanitize errors before sending to Telegram (HTML parse_mode).
 * Never leak HTML pages, keys, hostnames, or model/GPU internals.
 */
export function userFacingTgError(
  raw: unknown,
  fallbackRu = "Что-то пошло не так. Попробуй ещё раз чуть позже.",
): string {
  const msg = raw instanceof Error ? raw.message : String(raw || "");
  const trimmed = msg.trim();
  if (!trimmed) return fallbackRu;

  // Cashera/nginx HTML error pages → Telegram "Unsupported start tag !doctype"
  if (
    /<!doctype|<\/html>|<html[\s>]|<head[\s>]|<body[\s>]/i.test(trimmed) ||
    /<\w+[\s>]/.test(trimmed.slice(0, 80))
  ) {
    return "Платёжный сервис временно не ответил. Выбери способ оплаты ещё раз через пару минут.";
  }

  if (
    /Cashera\s*[45]\d\d/i.test(trimmed) ||
    /payment_url|cashera|xpayconnect|client-api-key|\bXPAY_[A-Z0-9_]+\b|\b[a-f0-9]{32,64}\b/i.test(
      trimmed,
    )
  ) {
    return "Не удалось создать ссылку на оплату. Попробуй другой способ или повтори через минуту.";
  }

  if (/OutOfMemory|CUDA out of memory|ran out of memory/i.test(trimmed)) {
    return "Сервер сейчас перегружен. Подожди ~1 минуту и запусти генерацию ещё раз — средства вернули, если списание было.";
  }

  if (
    /Comfy wait timeout|wait timeout|ECONN|ETIMEDOUT|socket hang|Bad Gateway|8188|fetch failed|tg_\w+_transient|download failed/i.test(
      trimmed,
    )
  ) {
    return "Сервер временно недоступен. Подожди ~30 сек и запусти снова.";
  }

  if (/Metalnode|bmserv|RunPod|workerId|prompt_id|KSampler|UNET|LoRA|\.safetensors/i.test(trimmed)) {
    return fallbackRu;
  }

  // Strip angle brackets so HTML parse_mode won't choke on leftovers.
  const clean = trimmed
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280);

  if (!clean || clean.length < 3) return fallbackRu;
  // Avoid dumping raw stack-ish blobs
  if (/at\s+\S+\s+\(|\/app\/src\//i.test(clean)) return fallbackRu;
  return clean;
}
