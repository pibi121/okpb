import type { OpsSection } from "@/lib/ops/roles";

export const OPS_NAV: { href: string; section: OpsSection; label: string }[] = [
  { href: "/ops", section: "dashboard", label: "Главная" },
  { href: "/ops/users", section: "users", label: "Люди" },
  { href: "/ops/jobs", section: "jobs", label: "Работы" },
  { href: "/ops/errors", section: "errors", label: "Ошибки" },
  { href: "/ops/load", section: "load", label: "Нагрузка" },
  { href: "/ops/queue", section: "queue", label: "Очередь" },
  { href: "/ops/links", section: "links", label: "Ссылки" },
  { href: "/ops/copy", section: "copy", label: "Тексты бота" },
  { href: "/ops/notices", section: "notices", label: "Уведомления" },
  { href: "/ops/broadcasts", section: "broadcasts", label: "Рассылки" },
  { href: "/ops/prices", section: "prices", label: "Цены" },
  { href: "/ops/partners", section: "partners", label: "Партнёры" },
  { href: "/ops/money", section: "money", label: "Деньги" },
  { href: "/ops/bot", section: "bot", label: "Бот" },
  { href: "/ops/team", section: "team", label: "Команда" },
  { href: "/ops/dev", section: "dev", label: "Разработка" },
];
