export async function cabinetFetch<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, { ...init, headers });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || "ошибка");
  return data;
}

export function rub(n: number) {
  return `${new Intl.NumberFormat("ru-RU").format(n)} ₽`;
}

export function when(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function roleLabel(role: string) {
  return role === "investor" ? "Инвестор" : "Байер";
}

export function payoutStatus(status: string) {
  if (status === "paid") return "выплачено";
  if (status === "rejected") return "отклонено";
  return "ждёт";
}
