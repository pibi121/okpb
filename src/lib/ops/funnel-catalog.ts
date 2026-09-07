/**
 * Human-readable funnel step catalog for ops + AI analysis export.
 * Keys are stable; titles/details are RU and describe the user action plainly.
 */

export type FunnelSurface = "bot" | "miniapp" | "system";

export type FunnelStepDef = {
  key: string;
  surface: FunnelSurface;
  /** Short label for tables */
  title: string;
  /** What this step means — for AI audience analysis */
  detail: string;
  /** Funnel stage bucket for conversion reports */
  stage:
    | "acquisition"
    | "onboarding"
    | "activation"
    | "generation"
    | "monetization"
    | "retention"
    | "navigation"
    | "support"
    | "partner"
    | "system";
};

const S = (
  key: string,
  surface: FunnelSurface,
  stage: FunnelStepDef["stage"],
  title: string,
  detail: string,
): FunnelStepDef => ({ key, surface, stage, title, detail });

export const FUNNEL_CATALOG: FunnelStepDef[] = [
  // —— acquisition / start ——
  S(
    "bot.start",
    "bot",
    "acquisition",
    "Открыл бота /start",
    "Пользователь нажал Start или отправил /start. Точка входа в продукт.",
  ),
  S(
    "bot.start.returning",
    "bot",
    "acquisition",
    "Вернулся в бота (/start, уже прошёл правила)",
    "Уже подтвердил возраст/правила; снова открыл бота — показал главное меню.",
  ),
  S(
    "bot.start.photos_upload",
    "bot",
    "activation",
    "Deep-link: загрузка фото персонажа из Mini App",
    "Пришёл по ссылке photos_* чтобы прислать альбом фото для LoRA в чат бота.",
  ),
  S(
    "bot.lang.ru",
    "bot",
    "onboarding",
    "Выбрал язык: русский",
    "Кнопка «Русский» на первом экране онбординга.",
  ),
  S(
    "bot.lang.en",
    "bot",
    "onboarding",
    "Выбрал язык: English",
    "Кнопка «English» на первом экране онбординга.",
  ),
  S(
    "bot.lang.switch",
    "bot",
    "support",
    "Сменил язык (уже в продукте)",
    "Смена языка из помощи / профиля после онбординга.",
  ),
  S(
    "bot.rules.shown",
    "bot",
    "onboarding",
    "Показан экран правил",
    "Бот показал текст правил и кнопку согласия.",
  ),
  S(
    "bot.rules.agree",
    "bot",
    "onboarding",
    "Согласился с правилами (18+)",
    "Кнопка «Согласен» / rules:agree — критический шаг входа.",
  ),
  S(
    "bot.welcome.after_rules",
    "bot",
    "onboarding",
    "Welcome после правил («Ну что, пофантазируем?»)",
    "Показан welcome с кнопками студии/создания персонажа; стартовали таймеры drip-воронки.",
  ),

  // —— reply keyboard ——
  S(
    "bot.menu.main",
    "bot",
    "navigation",
    "Нижнее меню: Главное",
    "Нажал кнопку reply-клавиатуры «Главное» / Main.",
  ),
  S(
    "bot.menu.generation",
    "bot",
    "activation",
    "Нижнее меню: Генерация",
    "Открыл выбор фото/видео генерации из нижней клавиатуры.",
  ),
  S(
    "bot.menu.characters",
    "bot",
    "activation",
    "Нижнее меню: Персонажи",
    "Открыл список персонажей из нижней клавиатуры.",
  ),
  S(
    "bot.menu.balance",
    "bot",
    "monetization",
    "Нижнее меню: Баланс",
    "Посмотрел баланс персиков из нижней клавиатуры.",
  ),
  S(
    "bot.menu.earn",
    "bot",
    "partner",
    "Нижнее меню: Заработок",
    "Открыл партнёрский кабинет / реферальную ссылку из меню.",
  ),
  S(
    "bot.menu.community",
    "bot",
    "retention",
    "Нижнее меню: Комьюнити",
    "Открыл ссылку на сообщество.",
  ),
  S(
    "bot.menu.help",
    "bot",
    "support",
    "Нижнее меню: Помощь",
    "Открыл справку / помощь.",
  ),
  S(
    "bot.menu.topup",
    "bot",
    "monetization",
    "Кнопка пополнения (reply)",
    "Нажал «Пополнить» с нижней клавиатуры или из текста баланса.",
  ),

  // —— welcome inline ——
  S(
    "bot.welcome.pick_studio",
    "bot",
    "activation",
    "Welcome: открыть студийных моделей (Mini App)",
    "Кнопка web_app выбора студийного каста с welcome-экрана.",
  ),
  S(
    "bot.welcome.create_char",
    "bot",
    "activation",
    "Welcome: создать своего персонажа (Mini App LoRA)",
    "Кнопка web_app обучения своего персонажа с welcome-экрана.",
  ),
  S(
    "bot.onboard.upload_char",
    "bot",
    "activation",
    "Онбординг: загрузить персонажа в боте",
    "Inline-кнопка начала создания персонажа через чат (не Mini App).",
  ),
  S(
    "bot.onboard.back_name",
    "bot",
    "activation",
    "Онбординг: назад к имени персонажа",
    "Вернулся к шагу имени при создании персонажа.",
  ),
  S(
    "bot.onboard.pick_studio_cast",
    "bot",
    "activation",
    "Онбординг: выбрал студийную модель",
    "Выбрал готовый studio cast кнопкой в боте.",
  ),
  S(
    "bot.onboard.pay_train",
    "bot",
    "monetization",
    "Онбординг: оплатить/запустить обучение LoRA",
    "Кнопка повторного запуска обучения после пополнения.",
  ),
  S(
    "bot.photo.uploaded",
    "bot",
    "activation",
    "Прислал фото в чат (обучение/реф)",
    "Пользователь отправил фото в состоянии загрузки персонажа или video-ref.",
  ),

  // —— generation ——
  S(
    "bot.gen.kind_photo",
    "bot",
    "generation",
    "Генерация: выбрал Фото",
    "Выбор типа генерации — фото.",
  ),
  S(
    "bot.gen.kind_video",
    "bot",
    "generation",
    "Генерация: выбрал Видео",
    "Выбор типа генерации — видео.",
  ),
  S(
    "bot.gen.template_pick",
    "bot",
    "generation",
    "Генерация: выбрал шаблон/позу",
    "Кликнул конкретный шаблон в списке (фото или видео).",
  ),
  S(
    "bot.gen.template_page",
    "bot",
    "generation",
    "Генерация: листание страницы шаблонов",
    "Перелистнул страницу списка шаблонов.",
  ),
  S(
    "bot.gen.pick_cast",
    "bot",
    "generation",
    "Генерация: выбрал модель/каст",
    "Выбрал персонажа/каст перед генерацией.",
  ),
  S(
    "bot.gen.cast_page",
    "bot",
    "generation",
    "Генерация: листание кастов",
    "Перелистнул список моделей.",
  ),
  S(
    "bot.gen.confirm",
    "bot",
    "generation",
    "Генерация: подтвердил запуск",
    "Нажал «Сгенерировать» / confirm — старт платной/бесплатной генерации.",
  ),
  S(
    "bot.gen.back_templates",
    "bot",
    "generation",
    "Генерация: назад к шаблонам",
    "Вернулся к выбору поз/шаблонов.",
  ),
  S(
    "bot.gen.again_photo",
    "bot",
    "generation",
    "Генерация: ещё фото",
    "После результата нажал «ещё фото».",
  ),
  S(
    "bot.gen.again_video",
    "bot",
    "generation",
    "Генерация: ещё видео",
    "После результата нажал «ещё видео».",
  ),
  S(
    "bot.gen.to_hub",
    "bot",
    "navigation",
    "Генерация: в главное меню",
    "После генерации вернулся в хаб.",
  ),
  S(
    "bot.gen.started",
    "bot",
    "generation",
    "Генерация реально стартовала (job)",
    "Система приняла задачу генерации (фото/видео).",
  ),
  S(
    "bot.gen.delivered",
    "bot",
    "generation",
    "Результат генерации доставлен",
    "Пользователь получил готовое фото/видео в чат или галерею.",
  ),
  S(
    "bot.gen.failed",
    "bot",
    "generation",
    "Генерация упала с ошибкой",
    "Job завершился ошибкой — важно для отвала воронки.",
  ),

  // —— video refs / lora ——
  S(
    "bot.video.pick_ref",
    "bot",
    "generation",
    "Видео: выбрал сохранённую модель-реф",
    "Выбрал ранее сохранённый video-ref персонаж.",
  ),
  S(
    "bot.video.pick_lora",
    "bot",
    "generation",
    "Видео: выбрал LoRA-персонажа",
    "Выбрал обученного персонажа для видео.",
  ),
  S(
    "bot.video.upload_new",
    "bot",
    "activation",
    "Видео: загрузить новые фото модели",
    "Начал загрузку новых реф-фото для видео.",
  ),
  S(
    "bot.video.photos_done",
    "bot",
    "activation",
    "Видео: фото набраны, готово",
    "Нажал «Готово» после загрузки реф-фото.",
  ),
  S(
    "bot.video.train_lora",
    "bot",
    "activation",
    "Видео: запустить обучение LoRA",
    "Кнопка старта обучения из video-flow.",
  ),
  S(
    "bot.video.save_model",
    "bot",
    "retention",
    "Видео: сохранить модель",
    "Сохранил video-ref модель для повторных генераций.",
  ),
  S(
    "bot.video.save_skip",
    "bot",
    "retention",
    "Видео: не сохранять модель",
    "Отказался сохранять модель после видео.",
  ),

  // —— characters ——
  S(
    "bot.char.select",
    "bot",
    "activation",
    "Персонажи: выбрал активного",
    "Выбрал персонажа в списке бота.",
  ),
  S(
    "bot.char.new",
    "bot",
    "activation",
    "Персонажи: создать нового",
    "Нажал создать нового персонажа в боте.",
  ),
  S(
    "bot.char.back",
    "bot",
    "navigation",
    "Персонажи: назад",
    "Назад из карточки персонажа.",
  ),
  S(
    "bot.char.add_photos",
    "bot",
    "activation",
    "Персонажи: добавить фото",
    "Начал догрузку фото к персонажу.",
  ),
  S(
    "bot.char.rename",
    "bot",
    "activation",
    "Персонажи: переименовать",
    "Начал переименование персонажа.",
  ),
  S(
    "bot.char.lookbook",
    "bot",
    "generation",
    "Персонажи: лукбук",
    "Открыл lookbook персонажа.",
  ),
  S(
    "bot.lookbook.click",
    "bot",
    "generation",
    "Лукбук: клик по элементу",
    "Клик внутри lookbook-flow.",
  ),

  // —— topup / help ——
  S(
    "bot.topup.open",
    "bot",
    "monetization",
    "Пополнение: открыл выбор суммы",
    "Открыл экран выбора пакета персиков.",
  ),
  S(
    "bot.topup.amount",
    "bot",
    "monetization",
    "Пополнение: выбрал сумму",
    "Кликнул конкретный пакет (сумма в meta.amount).",
  ),
  S(
    "bot.topup.paid",
    "bot",
    "monetization",
    "Пополнение: оплата прошла",
    "Успешное зачисление персиков (критическая конверсия).",
  ),
  S(
    "bot.help.lang",
    "bot",
    "support",
    "Помощь: сменить язык",
    "Кнопка смены языка из help.",
  ),
  S(
    "bot.callback.other",
    "bot",
    "navigation",
    "Прочий клик по inline-кнопке",
    "Callback, который не попал в именованный каталог — смотри meta.callback.",
  ),

  // —— system drips ——
  S(
    "system.drip.5m",
    "system",
    "retention",
    "Drip +5 мин: напоминание (train/cast/video)",
    "Автосообщение через 5 минут после welcome с тремя CTA.",
  ),
  S(
    "system.drip.10m_idle",
    "system",
    "retention",
    "Drip +10 мин: idle без генерации (кружок+текст)",
    "Напоминание тем, кто ещё не сгенерил за 10 минут.",
  ),
  S(
    "system.drip.40m",
    "system",
    "retention",
    "Drip +40 мин: студия",
    "Автопуш через 40 минут — CTA в Mini App студию.",
  ),
  S(
    "system.drip.6h",
    "system",
    "retention",
    "Drip +6 ч: лента",
    "Автопуш через 6 часов — CTA в ленту Mini App.",
  ),
  S(
    "system.welcome_push",
    "system",
    "retention",
    "Отложенный welcome-push",
    "Старый welcome free push после онбординга.",
  ),

  // —— miniapp screens ——
  S(
    "miniapp.open",
    "miniapp",
    "activation",
    "Mini App: открыл приложение",
    "Успешная авторизация WebApp (auth+me).",
  ),
  S(
    "miniapp.screen.feed",
    "miniapp",
    "navigation",
    "Mini App экран: Лента / шаблоны",
    "Просмотр главной ленты (/tg или /tg/templates).",
  ),
  S(
    "miniapp.screen.gallery",
    "miniapp",
    "navigation",
    "Mini App экран: Галерея",
    "Открыл свою галерею результатов.",
  ),
  S(
    "miniapp.screen.characters",
    "miniapp",
    "activation",
    "Mini App экран: Персонажи",
    "Раздел персонажей / кастов.",
  ),
  S(
    "miniapp.screen.photo",
    "miniapp",
    "generation",
    "Mini App экран: Фото",
    "Раздел генерации фото.",
  ),
  S(
    "miniapp.screen.video",
    "miniapp",
    "generation",
    "Mini App экран: Видео",
    "Раздел генерации видео.",
  ),
  S(
    "miniapp.screen.profile",
    "miniapp",
    "navigation",
    "Mini App экран: Профиль",
    "Профиль пользователя.",
  ),
  S(
    "miniapp.screen.partner",
    "miniapp",
    "partner",
    "Mini App экран: Партнёрка",
    "Партнёрский кабинет в Mini App.",
  ),
  S(
    "miniapp.screen.rules",
    "miniapp",
    "support",
    "Mini App экран: Правила",
    "Открыл правила внутри Mini App.",
  ),
  S(
    "miniapp.screen.other",
    "miniapp",
    "navigation",
    "Mini App экран: другой путь",
    "Просмотр экрана вне основных табов — путь в meta.path.",
  ),
  S(
    "miniapp.tab.feed",
    "miniapp",
    "navigation",
    "Таббар: Лента",
    "Клик по нижнему табу «Лента».",
  ),
  S(
    "miniapp.tab.gallery",
    "miniapp",
    "navigation",
    "Таббар: Галерея",
    "Клик по нижнему табу «Галерея».",
  ),
  S(
    "miniapp.tab.characters",
    "miniapp",
    "navigation",
    "Таббар: Персонажи",
    "Клик по нижнему табу «Персонажи».",
  ),
  S(
    "miniapp.tab.photo",
    "miniapp",
    "navigation",
    "Таббар: Фото",
    "Клик по нижнему табу «Фото».",
  ),
  S(
    "miniapp.tab.video",
    "miniapp",
    "navigation",
    "Таббар: Видео",
    "Клик по нижнему табу «Видео».",
  ),
  S(
    "miniapp.tab.profile",
    "miniapp",
    "navigation",
    "Таббар: Профиль",
    "Клик по нижнему табу «Профиль».",
  ),
  S(
    "miniapp.action",
    "miniapp",
    "generation",
    "Mini App: действие/кнопка",
    "Явный трек действия (кнопка, старт генерации и т.п.) — детали в meta.",
  ),
  S(
    "miniapp.send_to_bot",
    "miniapp",
    "activation",
    "Mini App: отправил действие в бот (sendData)",
    "WebApp.sendData — закрыл миниапп и передал payload боту.",
  ),
  S(
    "miniapp.footer.rules",
    "miniapp",
    "support",
    "Футер: Правила",
    "Клик по ссылке правил в подвале Mini App.",
  ),
  S(
    "miniapp.footer.support",
    "miniapp",
    "support",
    "Футер: Поддержка",
    "Клик по поддержке в подвале Mini App.",
  ),
];

const BY_KEY = new Map(FUNNEL_CATALOG.map((s) => [s.key, s]));

export function getFunnelStep(key: string): FunnelStepDef {
  return (
    BY_KEY.get(key) || {
      key,
      surface: "bot",
      stage: "navigation",
      title: `Неизвестный шаг: ${key}`,
      detail:
        "Событие без записи в каталоге. Добавьте ключ в funnel-catalog.ts для понятного AI-экспорта.",
    }
  );
}

export function listFunnelCatalog() {
  return FUNNEL_CATALOG;
}

/** Map Telegram callback_data → catalog key (+ optional meta). */
export function resolveBotCallback(data: string): {
  key: string;
  meta?: Record<string, unknown>;
} {
  if (data === "lang:ru") return { key: "bot.lang.ru" };
  if (data === "lang:en") return { key: "bot.lang.en" };
  if (data === "rules:agree" || data === "rulesAgree") return { key: "bot.rules.agree" };
  if (data === "ob:up") return { key: "bot.onboard.upload_char" };
  if (data === "ob:bn") return { key: "bot.onboard.back_name" };
  if (data === "ob:kp") return { key: "bot.gen.kind_photo" };
  if (data === "ob:kv") return { key: "bot.gen.kind_video" };
  if (data.startsWith("ob:sc:")) {
    return { key: "bot.onboard.pick_studio_cast", meta: { castId: data.slice(6) } };
  }
  if (data.startsWith("ob:pt:")) {
    return {
      key: "bot.onboard.pay_train",
      meta: { characterId: data.slice(6) },
    };
  }
  if (data === "g:k:p") return { key: "bot.gen.kind_photo" };
  if (data === "g:k:v") return { key: "bot.gen.kind_video" };
  if (data.startsWith("g:pi:")) {
    return { key: "bot.gen.template_pick", meta: { callback: data } };
  }
  if (data.startsWith("g:pg:")) {
    return { key: "bot.gen.template_page", meta: { callback: data } };
  }
  if (data.startsWith("g:mc:")) {
    return { key: "bot.gen.pick_cast", meta: { castId: data.slice(5) } };
  }
  if (data.startsWith("g:cp:")) {
    return { key: "bot.gen.cast_page", meta: { page: data.slice(5) } };
  }
  if (data === "g:go") return { key: "bot.gen.confirm" };
  if (data === "g:bt") return { key: "bot.gen.back_templates" };
  if (data === "g:ap") return { key: "bot.gen.again_photo" };
  if (data === "g:av") return { key: "bot.gen.again_video" };
  if (data === "g:hub") return { key: "bot.gen.to_hub" };
  if (data.startsWith("vid:ref:")) {
    return { key: "bot.video.pick_ref", meta: { id: data.slice(8) } };
  }
  if (data.startsWith("vid:lora:")) {
    return { key: "bot.video.pick_lora", meta: { id: data.slice(9) } };
  }
  if (data === "vid:new") return { key: "bot.video.upload_new" };
  if (data === "vid:done") return { key: "bot.video.photos_done" };
  if (data === "vid:train") return { key: "bot.video.train_lora" };
  if (data.startsWith("vid:save:")) {
    return { key: "bot.video.save_model", meta: { id: data.slice(9) } };
  }
  if (data === "vid:skip") return { key: "bot.video.save_skip" };
  if (data.startsWith("char:sel:")) {
    return { key: "bot.char.select", meta: { id: data.slice(9) } };
  }
  if (data === "char:new") return { key: "bot.char.new" };
  if (data === "char:back") return { key: "bot.char.back" };
  if (data.startsWith("char:ph:")) {
    return { key: "bot.char.add_photos", meta: { id: data.slice(8) } };
  }
  if (data.startsWith("char:ren:")) {
    return { key: "bot.char.rename", meta: { id: data.slice(9) } };
  }
  if (data.startsWith("char:lb:")) {
    return { key: "bot.char.lookbook", meta: { id: data.slice(8) } };
  }
  if (data.startsWith("lb:") || data.startsWith("look:")) {
    return { key: "bot.lookbook.click", meta: { callback: data } };
  }
  if (data === "tu:open") return { key: "bot.topup.open" };
  if (data.startsWith("tu:")) {
    return { key: "bot.topup.amount", meta: { amount: Number(data.slice(3)) || 0 } };
  }
  if (data === "help:lang") return { key: "bot.help.lang" };
  return { key: "bot.callback.other", meta: { callback: data } };
}

export function resolveMiniAppPath(pathname: string): string {
  const p = pathname.replace(/\/+$/, "") || "/tg";
  if (p === "/tg" || p === "/tg/templates") return "miniapp.screen.feed";
  if (p.startsWith("/tg/gallery")) return "miniapp.screen.gallery";
  if (p.startsWith("/tg/characters") || p === "/tg/casts") {
    return "miniapp.screen.characters";
  }
  if (p.startsWith("/tg/photo") || p === "/tg/studio-photo") {
    return "miniapp.screen.photo";
  }
  if (p.startsWith("/tg/video")) return "miniapp.screen.video";
  if (p.startsWith("/tg/partner")) return "miniapp.screen.partner";
  if (p.startsWith("/tg/profile")) return "miniapp.screen.profile";
  if (p.startsWith("/tg/rules")) return "miniapp.screen.rules";
  return "miniapp.screen.other";
}
