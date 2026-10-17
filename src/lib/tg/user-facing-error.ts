/**
 * Sanitize errors before they reach a person (Telegram or Mini App).
 * Ops logs keep the raw text. This layer never does.
 */

const DEFAULT_RU =
  "Что-то пошло не так. Попробуй ещё раз чуть позже.";

/** Internals, dumps, hosts, engines, stacks. Not a sentence we wrote for a person. */
const TECHNICAL =
  /<!doctype|<\/?[a-z!]|\{|\}|\[|\]|https?:\/\/|\/app\/|\\\\|node\s*=|traceback|exception_|ComfyUI|\bComfy\b|CUDA|OutOfMemory|KSampler|\bUNET\b|\.safetensors|Metalnode|bmserv|RunPod|Ollama|prompt_id|workerId|\bECONN|\bETIMEDOUT|\bENOSPC|\bENOTFOUND|\bEAI_AGAIN|socket hang|\bsqlite\b|\bprisma\b|\bffmpeg\b|MiniMax|TypeError|ValueError|RuntimeError|KeyError|AttributeError|OSError|SyntaxError|ReferenceError|fetch failed|Bad Gateway|Telegram HTTP|\bHTTP\s*\d{3}\b|Cannot read propert|is not a function|is not defined|\bat\s+\S+\s+\(|\.py\b|\b8188\b|\bgpu\d\b|\btunnel\b|DATABASE_URL|api[_-]?key|\bsecret\b|\bpassword\b|token=|errno|\bspawn\b|\bstdout\b|\bstderr\b|execution_error|status_str|\bundefined\b|\bNaN\b|\d{2,}x\d{2,}/i;

export function plainErrorText(raw: unknown): string {
  const msg = raw instanceof Error ? raw.message : String(raw ?? "");
  return msg
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Short copy we authored (Russian, or a plain English sentence). */
export function isUserReadableCopy(raw: unknown): boolean {
  const text = plainErrorText(raw);
  if (text.length < 3 || text.length > 240) return false;
  if (TECHNICAL.test(text)) return false;
  if (/[<>`]/.test(text)) return false;
  if (/[a-z]+_[a-z0-9]+/i.test(text)) return false;
  if (/[A-Za-z]:\\/.test(text)) return false;
  if (/[а-яё]/i.test(text)) return true;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 4) return false;
  return /^[A-Z«"']/.test(text);
}

/**
 * Safe text for a person. Unknown technical dumps become `fallback`.
 * A short human sentence we already wrote is kept.
 */
export function userFacingTgError(
  raw: unknown,
  fallback = DEFAULT_RU,
): string {
  const trimmed = plainErrorText(raw);
  if (!trimmed) return fallback;

  if (
    /<!doctype|<\/html>|<html[\s>]|<head[\s>]|<body[\s>]/i.test(trimmed) ||
    /<\w+[\s>]/.test(trimmed.slice(0, 80))
  ) {
    return "Платёжный сервис временно не ответил. Выбери способ оплаты ещё раз через пару минут.";
  }

  if (/Cashera\s*[45]\d\d/i.test(trimmed) || /payment_url|\bcashera\b/i.test(trimmed)) {
    return "Не удалось создать ссылку на оплату. Попробуй другой способ или повтори через минуту.";
  }

  if (/OutOfMemory|CUDA out of memory|ran out of memory/i.test(trimmed)) {
    return "Сервер сейчас перегружен. Подожди ~1 минуту и запусти генерацию ещё раз — средства вернули, если списание было.";
  }

  if (
    /Comfy wait timeout|wait timeout|\bECONN|\bETIMEDOUT|socket hang|Bad Gateway|\b8188\b|fetch failed|tg_\w+_transient|download failed/i.test(
      trimmed,
    )
  ) {
    return "Сервер временно недоступен. Подожди ~30 сек и запусти снова.";
  }

  if (
    /\bComfy\b|ComfyUI|missing_node|MiniMax|node_type|node\s*=|KSampler|traceback|execution_error/i.test(
      trimmed,
    )
  ) {
    return "Не получилось собрать. Это сбой у нас — попробуй ещё раз через минуту.";
  }

  if (isUserReadableCopy(trimmed)) return trimmed.slice(0, 280);
  return fallback;
}

/**
 * Prefix only when `raw` is already a human sentence.
 * A Comfy dump becomes `fallback` alone, without the dump glued on.
 */
export function userFacingFailure(
  raw: unknown,
  fallback: string,
  prefix?: string,
): string {
  const safe = userFacingTgError(raw, fallback);
  if (!prefix || !isUserReadableCopy(raw)) return safe;
  const original = plainErrorText(raw).slice(0, 280);
  if (safe !== original) return safe;
  return `${prefix}${safe}`;
}
