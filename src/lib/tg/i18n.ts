export type TgLocale = "ru" | "en";

export const TG_LOCALES: TgLocale[] = ["ru", "en"];

export const LANG_PICK_RU = "🇷🇺 Русский";
export const LANG_PICK_EN = "🇺🇸 English";

export function isLangPick(text: string): text is typeof LANG_PICK_RU | typeof LANG_PICK_EN {
  return text === LANG_PICK_RU || text === LANG_PICK_EN;
}

export function localeFromLangPick(text: string): TgLocale {
  return text === LANG_PICK_EN ? "en" : "ru";
}

export function normalizeLocale(raw?: string | null): TgLocale {
  const s = (raw || "ru").toLowerCase().slice(0, 2);
  return s === "en" ? "en" : "ru";
}

type Dict = Record<string, { ru: string; en: string }>;

export const M: Dict = {
  bot_name: { ru: "PeachBitch", en: "PeachBitch" },

  /** Start pitch — always shown in Russian first (no language picker). Video kept. */
  start_pitch: {
    ru: `🍑<b>С Peachbitch ты воплотишь все свои фантазии.</b> Если ты устал от размазанных пластиковых фото и видео в других ботах-раздеваторах, то добро пожаловать в настоящую порно-студию с самыми реалистичными кадрами, как будто смотришь вживую.

Раздеть подругу, коллегу, блогершу, актрису? Изи!

Здесь ты сможешь создавать настоящие порно фильмы, фотосессии и сцены с сюжетами, разговорами. Здесь есть всё, чтобы воплощать твои самые грязные фантазии без цензуры и ограничений`,
    en: `🍑<b>With Peachbitch you can bring every fantasy to life.</b> Tired of blurry plastic shots from other undress bots? Welcome to a real porn studio with the most realistic frames — as if you're watching live.

Undress a girlfriend, colleague, blogger, actress? Easy!

Here you can create real porn films, photoshoots and scenes with plots and dialogue. Everything you need for your dirtiest fantasies — no censorship, no limits`,
  },

  rules_step: {
    ru: `<b>⚠️ Дальше ты можешь устраивать настоящую грязь!</b>

А для этого нужно, чтобы ты принял <a href="{rulesUrl}">правила пользования ботом</a> и ознакомился с оффертой, а также подтвердил, что тебе исполнилось 18 лет. Просто нажми на кнопку ниже`,
    en: `<b>⚠️ Things are about to get dirty!</b>

Please accept our <a href="{rulesUrl}">Terms of Service</a> and confirm you are 18+. Tap the button below`,
  },

  rules_agree_btn: {
    ru: "✅ Принимаю правила и оферту",
    en: "✅ I accept the rules & offer",
  },

  rules_nudge_prefix: {
    ru: `<b>Напоминание</b> — без этого шага студия закрыта.

`,
    en: `<b>Reminder</b> — you need this step to open the studio.

`,
  },

  rules_agree_failed: {
    ru: "Не удалось принять правила. Нажми кнопку ещё раз.",
    en: "Could not accept the rules. Tap the button again.",
  },

  welcome_after_rules: {
    ru: `<b>Добро пожаловать в PeachBitch</b> — место, после которого ты забудешь адреса всех сайтов 🔞🍓⬛️🟧 и станешь режиссёром своих удовольствий!

Что можно в этом боте?

1. Сгенерировать фото на актрисах студии — на старте на балансе есть персики на одно фото
2. Создать <b>реалистичные фото</b> со своей моделью (после обучения)
3. <b>Оживить</b> фото или снять <b>видео</b> с сюжетами, позами и диалогами

📸 <b>Нужны фото?</b> Зайди в маркетплейс персонажей → выбери актрису студии → шаблон → кадр за ~30 секунд. Когда убедишься в качестве — создай <b>свою</b> модель в «Персонажи» (от 5 фото, обучение ~2 часа).

🎬 <b>Нужно видео?</b> «Генерация» → «Видео» → шаблон → от 1 фото модели → готово через несколько минут. <i>Обучать персонажа для видео не нужно.</i>`,
    en: `<b>Welcome to PeachBitch</b> — forget every other site 🔞🍓 and become the director of your fantasies!

What you can do:

1. Photos with studio actresses — starter peaches cover one photo so you can check quality
2. <b>Realistic photos</b> with your own model (after training)
3. <b>Animate</b> photos or shoot <b>videos</b> with plots, poses & dialogue

📸 <b>Photos?</b> Open the cast marketplace → pick a studio actress → template → ~30 sec. When you're sold — create <b>your</b> model in «Characters» (5+ photos, ~2h training).

🎬 <b>Video?</b> «Generation» → «Video» → template → from 1 photo → ready in minutes. <i>No character training required for video.</i>`,
  },

  /** Kept for ops overlay; blast itself is disabled. */
  welcome_free_push: {
    ru: `Не тяни. Попробуй наш фото-генератор в деле!

🎁 1 бесплатная генерация фото по образу с нашими актрисами. Убедись в качестве и реалистичности, а потом создавай образы со своей подругой, коллегой, блогершей, актрисой.

Выбери актрису из нашего каталога и сделай фото. Кстати, некоторых актрис из нашего каталога ты точно знаешь`,
    en: `Don't wait — try our photo generator!

🎁 1 free look-based photo with our actresses. Check the quality and realism, then create looks with your girlfriend, colleague, blogger, or actress.

Pick an actress from the catalog and make a photo. You'll recognize some of them 😉`,
  },

  welcome_free_push_catalog_btn: {
    ru: "Перейти в каталог",
    en: "Open catalog",
  },

  /** Funnel drip #1 — 5 min after welcome (RU first; EN mirrors RU for now). */
  funnel_5m: {
    ru: `<b>Боты-раздеваторы в прошлом</b>

Пока другие переплачивают за глянцевые фотки/видео, у тебя на выбор десятки (скоро сотни и тысячи) шаблонов для генерации реалистичных кадров.

PeachBitch это не бот раздеватор, а полноценная ИИ порно-студия, где ты главный режиссёр. Никакой цензуры, чистый секс и удовольствия, сюжеты и новые эмоции. Любая девушка из твоих желаний сделает всё, что ты захочешь

Для генерации реалистичных фотографий со своей моделью, тебе нужно сначала собрать её образ. Нажми внизу «Собрать образ»

Или можешь сравнить качество фоток и сделать генерацию фотографии с одной из наших актрис.

А для видео достаточно выбрать шаблон, загрузить фотку любой девушки и всё`,
    en: `<b>Боты-раздеваторы в прошлом</b>

Пока другие переплачивают за глянцевые фотки/видео, у тебя на выбор десятки (скоро сотни и тысячи) шаблонов для генерации реалистичных кадров.

PeachBitch это не бот раздеватор, а полноценная ИИ порно-студия, где ты главный режиссёр. Никакой цензуры, чистый секс и удовольствия, сюжеты и новые эмоции. Любая девушка из твоих желаний сделает всё, что ты захочешь

Для генерации реалистичных фотографий со своей моделью, тебе нужно сначала собрать её образ. Нажми внизу «Собрать образ»

Или можешь сравнить качество фоток и сделать генерацию фотографии с одной из наших актрис.

А для видео достаточно выбрать шаблон, загрузить фотку любой девушки и всё`,
  },

  funnel_5m_btn_train: {
    ru: "Собрать образ",
    en: "Собрать образ",
  },
  funnel_5m_btn_cast: {
    ru: "Каталог актрис",
    en: "Каталог актрис",
  },
  funnel_5m_btn_video: {
    ru: "Сделать видео",
    en: "Сделать видео",
  },

  /** Funnel drip #2 — 40 min after welcome. */
  funnel_40m: {
    ru: `Видео, где её ебут
Видео, где она тебя соблазняет
Видео, где её унижают

Ты можешь создать любое видео из шаблона, загрузив 1 фотографию любой подруги, знакомой, актрисы, блогерши. Переходи в студию, выбери шаблон, загрузи фото и готово!`,
    en: `Видео, где её ебут
Видео, где она тебя соблазняет
Видео, где её унижают

Ты можешь создать любое видео из шаблона, загрузив 1 фотографию любой подруги, знакомой, актрисы, блогерши. Переходи в студию, выбери шаблон, загрузи фото и готово!`,
  },

  funnel_40m_btn: {
    ru: "Открыть студию",
    en: "Открыть студию",
  },

  /** Funnel drip #3 — 6 h after welcome. */
  funnel_6h: {
    ru: `Зачем ты смотришь порнхаб, когда есть наша лента?

Просто открой ленту PeachBitch и посмотри на наши работы. А если что-то понравится и ты захочешь это повторить с любой девушкой – используй как шаблон, в 1 клик.`,
    en: `Зачем ты смотришь порнхаб, когда есть наша лента?

Просто открой ленту PeachBitch и посмотри на наши работы. А если что-то понравится и ты захочешь это повторить с любой девушкой – используй как шаблон, в 1 клик.`,
  },

  funnel_6h_btn: {
    ru: "Открыть ленту",
    en: "Открыть ленту",
  },

  /** Funnel drip #4 — 10 min idle (no gens) after welcome. */
  funnel_10m_idle: {
    ru: `😭🥺 Она грустит из-за того, что ты ещё не сделал ни одного фото или видео

Воспользуйся кнопками в меню или открой мини-апп по кнопке «Студия»`,
    en: `😭🥺 Она грустит из-за того, что ты ещё не сделал ни одного фото или видео

Воспользуйся кнопками в меню или открой мини-апп по кнопке «Студия»`,
  },

  funnel_10m_btn: {
    ru: "Открыть студию",
    en: "Открыть студию",
  },

  idle_3d: {
    ru: "Вас не было 3 дня. В ленте появились новые шаблоны",
    en: "You were away for 3 days. New templates are in the feed",
  },

  idle_7d: {
    ru: "Вас не было 7 дней. В ленте появились новые шаблоны",
    en: "You were away for 7 days. New templates are in the feed",
  },

  idle_view_templates_btn: {
    ru: "Посмотреть шаблоны",
    en: "Browse templates",
  },

  idle_topup_btn: {
    ru: "Пополнить баланс",
    en: "Top up balance",
  },

  onboard_pick_studio_btn: {
    ru: "🎭 Выбрать актрису студии",
    en: "🎭 Pick studio actress",
  },

  onboard_create_char_btn: {
    ru: "👤 Создать своего персонажа",
    en: "👤 Create your character",
  },

  onboard_upload_char_btn: {
    ru: "👤 Создать своего персонажа",
    en: "👤 Create your character",
  },

  onboard_name_prompt: {
    ru: "<b>Как ты назовёшь своего персонажа?</b>\n\nВведи имя, чтобы потом не путаться в списке",
    en: "<b>What will you name your character?</b>\n\nEnter a name so you won't mix them up later",
  },

  onboard_photo_prompt: {
    ru: `В отличие от других ботов и сервисов, мы создаём фотографии максимально близкие к реальным. Для этого нужно обучить систему внешности твоего персонажа — это занимает от 1 до 2 часов. От тебя нужно <b>от 5 фотографий</b> модели (если больше — ещё лучше).

<i>Важно! Для видео обучать персонажа не нужно — достаточно от 1 фото, и через несколько минут готовое видео.</i>`,
    en: `Unlike other bots, we aim for photos that look truly real. That requires training your character's look — about 1–2 hours. Send <b>at least 5 photos</b> (more is better).

<i>Important: video doesn't need training — from 1 photo, ready in minutes.</i>`,
  },

  onboard_lora_price: {
    ru: `Стоимость обучения персонажа (от 5 фото, до 20): <b>{price}🍑</b>
(обучается один раз — потом генерировать можно всегда)

<b>Акция!</b> Оплати и запусти обучение в течение 30 минут — выгоднее успеть сейчас.

На балансе должно быть от {price}🍑. У тебя сейчас: <b>{balance}🍑</b>.`,
    en: `Character training (5–20 photos): <b>{price}🍑</b>
(one-time — then generate forever)

<b>Promo!</b> Pay and start training within 30 minutes — better to catch it now.

You need {price}🍑 on balance. Yours: <b>{balance}🍑</b>.`,
  },

  onboard_lora_pay_train_btn: {
    ru: "🚀 Оплатить и обучить",
    en: "🚀 Pay & train",
  },

  onboard_lora_upload: {
    ru: `<b>Отправь от 5 до 20 фотографий</b> своего персонажа, чтобы начать обучение.

Рекомендации:
+ Фотографии в хорошем качестве
+ Есть фото, где видно лицо, взгляд в камеру, прямой ракурс
+ Внешность на фото сильно не меняется
+ Желательно фотографии в полный рост`,
    en: `<b>Send 5 to 20 photos</b> of your character to start training.

Tips:
+ Good quality
+ Face visible, looking at camera
+ Consistent appearance across photos
+ Full-body shots help`,
  },

  onboard_lora_started: {
    ru: `<b>✅ Обучение началось.</b>
С баланса списано {price}🍑

В течение ~2 часов PeachBitch научится делать реалистичные фото с твоей моделью. Мы пришлём уведомление, когда всё будет готово.

А пока можешь снять <b>видео</b> — обучение для этого не нужно.`,
    en: `<b>✅ Training started.</b>
{price}🍑 charged.

In ~2 hours you'll get realistic photos with your model. We'll notify you when it's done.

Meanwhile you can generate <b>video</b> — no training required.`,
  },

  onboard_lora_ready: {
    ru: `<b>🔥 Обучение завершилось!</b> Теперь ты можешь создавать реалистичные фото со своей моделью и оживлять их!

Модель «{name}» выбрана автоматически. «Генерация» → «Фото» → шаблон — или маркетплейс шаблонов.`,
    en: `<b>🔥 Training complete!</b> Create realistic photos with your model and animate them!

Model «{name}» is selected. «Generation» → «Photo» → template — or the template marketplace.`,
  },

  onboard_lora_welcome_bonus: {
    ru: "\n\nКстати, тебе доступно <b>5 бесплатных</b> генераций фото с новой моделью 🎁",
    en: "\n\nYou also have <b>5 free</b> photo generations with your new model 🎁",
  },

  lora_welcome_photos_left: {
    ru: "Осталось подарочных генераций: <b>{n}</b>",
    en: "Welcome photo generations left: <b>{n}</b>",
  },

  studio_cast_picked: {
    ru: "Актриса студии <b>{name}</b> выбрана ✅\n\nОткрой маркетплейс шаблонов или «Генерация» → «Фото», чтобы снять кадр.",
    en: "Studio actress <b>{name}</b> selected ✅\n\nOpen the template marketplace or «Generation» → «Photo».",
  },

  studio_free_daily: {
    ru: "0 🍑 (ежедневный кадр · актриса студии)",
    en: "0 🍑 (daily studio shot)",
  },

  studio_free_daily_note: {
    ru: "🎁 Сегодня этот кадр бесплатно (ежедневный бонус)",
    en: "🎁 Free today (daily studio bonus)",
  },

  gen_confirm_free_note: {
    ru: "🎁 Сейчас бесплатно (приветственные кадры)",
    en: "🎁 Free now (welcome shots)",
  },

  studio_free_not_ready: {
    ru: `Бесплатный кадр на актрисе студии обновляется раз в сутки.

Загляни в 🍑 <b>Маркетплейс</b>, чтобы активировать следующий — или пополни баланс для платной генерации.`,
    en: `Your free studio shot refreshes once a day.

Open 🍑 <b>Marketplace</b> to unlock the next one — or top up for a paid generation.`,
  },

  photo_need_lora: {
    ru: `Для фото со <b>своей</b> моделью нужно завершить подготовку внешности.

Пока можешь: бесплатный кадр на актрисе студии или видео без подготовки.`,
    en: `Photos with <b>your</b> model need appearance setup first.

Try a free studio shot or video without setup.`,
  },

  video_need_photo: {
    ru: "Для видео нужно хотя бы <b>1 фото</b> модели. Добавь в «Персонажи» или отправь фото в чат после выбора шаблона.",
    en: "Video needs at least <b>1 photo</b> of your model. Add in «Characters» or send a photo after picking a template.",
  },

  gen_video_now_btn: {
    ru: "🎬 Сгенерировать видео сейчас",
    en: "🎬 Generate video now",
  },

  gen_lora_photo_btn: {
    ru: "📸 Сгенерировать фото",
    en: "📸 Generate photo",
  },

  onboard_back_name_btn: {
    ru: "↩️ Вернуться и изменить",
    en: "↩️ Go back and change",
  },

  onboard_photo_progress: {
    ru: "📸 Фото {n}/{min}. {hint}",
    en: "📸 Photo {n}/{min}. {hint}",
  },

  onboard_photo_need_more: {
    ru: "Нужно ещё {n} фото.",
    en: "Need {n} more photo(s).",
  },

  onboard_character_saved: {
    ru: `<b>✅ Персонаж сохранён!</b>

Он будет в разделе "Персонажи" в нижнем меню, чтобы ты всегда мог отредактировать параметры тела, чтобы улучшить результат, а также добавить новых персонажей и переключаться между ними.

<i>Выбери, что ты хочешь сгенерировать? Фото или видео? 👇</i>`,
    en: `<b>✅ Character saved!</b>

Find her in "Characters" in the bottom menu — edit body settings, add more characters, switch between them.

<i>What do you want to generate? Photo or video? 👇</i>`,
  },

  gen_kind_photo_btn: { ru: "Фото по образу 🔞", en: "Photo by look 🔞" },
  gen_kind_video_btn: { ru: "Видео 🍓", en: "Video 🍓" },

  gen_pick_template: {
    ru: `Теперь выбери первую позу и сюжет, который хочешь увидеть на {kind}. Можешь кликнуть, посмотреть пример и принять решение. Или перейди в «Маркетплейс», чтобы пролистать ленту шаблонов.`,
    en: `Pick the first pose and scene for {kind}. Tap to preview. Or open «Marketplace» to scroll templates.`,
  },

  gen_kind_photo_label: { ru: "фото по образу", en: "photo by look" },
  gen_kind_video_label: { ru: "видео", en: "video" },
  gen_kind_video_one_label: { ru: "видео по 1 фото", en: "video from 1 photo" },
  gen_kind_video_look_label: { ru: "видео по образу", en: "video by look" },

  gen_video_mode_pick: {
    ru: `🍓 <b>Какое видео нужно?</b>

<b>Видео по 1 фото</b> — загружаешь один кадр модели, шаблон оживляет сцену. Обучать образ не нужно.

<b>Видео по образу</b> — максимум реализма с <b>обученной</b> моделью (своя или из витрины). Плашка «Макс. качество».`,
    en: `🍓 <b>Which video?</b>

<b>Video from 1 photo</b> — upload one still; the template animates it. No look training needed.

<b>Video by look</b> — max realism with a <b>trained</b> model (yours or studio). “Max quality” badge.`,
  },
  gen_video_mode_one_btn: { ru: "Видео по 1 фото", en: "Video from 1 photo" },
  gen_video_mode_look_btn: {
    ru: "Видео по образу · Макс. качество",
    en: "Video by look · Max quality",
  },

  marketplace_btn: { ru: "🍑 Маркетплейс", en: "🍑 Marketplace" },
  gen_page_prev: { ru: "◀️", en: "◀️" },
  gen_page_next: { ru: "▶️", en: "▶️" },

  gen_confirm_pose: {
    ru: `Выбранная поза: <b>{title}</b>

Стоимость генерации: {price}
У вас на балансе: <b>{balance}</b>🍑

Модель: <b>{name}</b>
Выбери актрису ниже и нажми «Сгенерировать».`,
    en: `Selected pose: <b>{title}</b>

Generation cost: {price}
Your balance: <b>{balance}</b>🍑

Model: <b>{name}</b>
Pick an actress below, then tap Generate.`,
  },

  gen_confirm_video_pose: {
    ru: `Выбранная поза: <b>{title}</b>

Стоимость генерации: {price}
У вас на балансе: <b>{balance}</b>🍑
{notes}
Дальше загрузи фото модели (или выбери сохранённую 🎬) — подготовка модели не нужна.`,
    en: `Selected pose: <b>{title}</b>

Generation cost: {price}
Your balance: <b>{balance}</b>🍑
{notes}
Next upload model photos (or pick a saved 🎬) — no model setup needed.`,
  },

  gen_confirm_video_best: {
    ru: `✨ <b>Макс. качество</b>

Поза: <b>{title}</b>
Стоимость генерации: {price}
У вас на балансе: <b>{balance}</b>🍑
{notes}
Этот формат работает <b>только с обученной моделью</b> (твоя или актриса студии). Обычное фото «с телефона» здесь не подойдёт — лицо держится за счёт подготовки.`,
    en: `✨ <b>Max quality</b>

Pose: <b>{title}</b>
Generation cost: {price}
Your balance: <b>{balance}</b>🍑
{notes}
This format works <b>only with a trained model</b> (yours or a studio actress). A plain phone selfie isn't enough — identity comes from setup.`,
  },

  video_lora_pick_title: {
    ru: `✨ Макс. качество — выбери обученную модель

Без готовой модели этот шаблон не запустится. Возьми свою или актрису из подборки:`,
    en: `✨ Max quality — pick a trained model

This template won't run without a ready model. Choose yours or a studio actress:`,
  },

  video_lora_need_train: {
    ru: `✨ <b>Макс. качество</b> — максимум реализма

Этот шаблон работает с обученной моделью: лицо стабильнее, кожа и детали ближе к «как в кино».

У тебя пока нет готовой модели.
Создай свою за ~1–2 часа (от 5 фото) — и этот уровень качества откроется навсегда. Или возьми актрису студии прямо сейчас.`,
    en: `✨ <b>Max quality</b> — max realism

This template runs on a trained model: stabler face, skin and detail closer to cinema.

You don't have a ready model yet.
Create yours in ~1–2 hours (from 5 photos) — and unlock this quality forever. Or pick a studio actress right now.`,
  },

  video_lora_train_btn: {
    ru: "🚀 Создать свою модель",
    en: "🚀 Create my model",
  },

  video_lora_studio_btn: {
    ru: "🎭 Актрисы студии",
    en: "🎭 Studio actresses",
  },

  video_upload_prompt: {
    ru: `Отправь <b>1–5 фото</b> лица модели в этот чат (можно несколько подряд).

Минимум — <b>1 фото</b>, генерация возможна сразу. Чем больше ракурсов (до 5), тем стабильнее лицо в видео.

Когда хватит — нажми «Готово, начать».`,
    en: `Send <b>1–5 photos</b> of the model's face (you can send several in a row).

Minimum is <b>1 photo</b>. More angles (up to 5) improve face consistency.

When ready — tap «Done, start».`,
  },

  upload_progress: {
    ru: `<b>Принято фотографий:</b> {accepted}
<b>Нужно ещё:</b> {need}

{extra}`,
    en: `<b>Photos received:</b> {accepted}
<b>Still need:</b> {need}

{extra}`,
  },

  upload_need_more: {
    ru: "Загрузи ещё {n} фото, чтобы продолжить.",
    en: "Upload {n} more photo(s) to continue.",
  },

  upload_min_reached: {
    ru: "Минимум достигнут ✅",
    en: "Minimum reached ✅",
  },

  upload_video_can_add_more: {
    ru: "Можно начать с 1 фото. Добавь ещё (до 5) для лучшего результата или нажми «Готово, начать».",
    en: "You can start with 1 photo. Add more (up to 5) for better results, or tap «Done, start».",
  },

  upload_video_max_reached: {
    ru: "Загружено максимум фото. Нажми «Готово, начать».",
    en: "Maximum photos uploaded. Tap «Done, start».",
  },

  upload_done_btn: {
    ru: "✅ Готово, начать",
    en: "✅ Done, start",
  },

  video_pick_ref_title: {
    ru: "Выбери сохранённую 🎬 модель или загрузи новые фото:",
    en: "Pick a saved 🎬 model or upload new photos:",
  },

  video_ref_upload_new: {
    ru: "📷 Загрузить новые фото",
    en: "📷 Upload new photos",
  },

  video_save_prompt: {
    ru: "Сохранить модель, чтобы без загрузки фото генерировать с ней новые видео?",
    en: "Save this model to generate new videos without re-uploading photos?",
  },

  video_save_yes: { ru: "✅ Да, сохранить", en: "✅ Yes, save" },
  video_save_skip: { ru: "Пропустить", en: "Skip" },

  video_ref_name_prompt: {
    ru: "Как назвать модель для видео? (будет 🎬 в списке)",
    en: "Name this video model? (shown with 🎬 in the list)",
  },

  gen_confirm_free: {
    ru: "0 🍑 (бесплатно)",
    en: "0 🍑 (free)",
  },

  gen_confirm_discount: {
    ru: "{base} 🍑 → <b>{price} 🍑</b> (−30% на первое видео)",
    en: "{base} 🍑 → <b>{price} 🍑</b> (−30% first video)",
  },

  gen_confirm_price: {
    ru: "{price} 🍑",
    en: "{price} 🍑",
  },

  gen_confirm_btn: { ru: "✅ Сгенерировать", en: "✅ Generate" },
  gen_other_poses_btn: { ru: "◀️ Другие позы", en: "◀️ Other poses" },

  gen_starting: {
    ru: "Начинаю генерацию! Пока можешь расслабиться и насладиться генерациями, которые делает наша команда",
    en: "Starting generation! Sit back and enjoy what our team creates",
  },
  gen_view_feed_btn: {
    ru: "Посмотреть генерации",
    en: "Browse generations",
  },

  gen_success: {
    ru: "<b>😍 {kind} готово!</b>\n\nХочешь попробовать сгенерировать ещё что-то?",
    en: "<b>😍 {kind} is ready!</b>\n\nWant to generate something else?",
  },

  gen_success_photo: { ru: "Фото", en: "Photo" },
  gen_success_video: { ru: "Видео", en: "Video" },

  gen_again_photo_btn: { ru: "Сгенерировать фото", en: "Generate photo" },
  gen_again_video_btn: { ru: "Сгенерировать видео", en: "Generate video" },
  gen_to_hub_btn: { ru: "В главное меню", en: "Main menu" },

  qc_dislike_photo_btn: {
    ru: "Не понравилось фото",
    en: "Didn't like the photo",
  },
  qc_dislike_video_btn: {
    ru: "Не понравилось видео",
    en: "Didn't like the video",
  },
  qc_confirm_prompt: {
    ru: `Если результат не соответствует заявленному по вашему мнению, нажми «Подтвердить». Мы просмотрим работу и если действительно так, то вернём персики на баланс.`,
    en: `If the result doesn't match what was promised in your view, tap Confirm. We'll review it and refund peaches if you're right.`,
  },
  qc_confirm_btn: { ru: "Подтвердить", en: "Confirm" },
  qc_submitted: {
    ru: "Отправлено на проверку",
    en: "Sent for review",
  },
  qc_btn_pending: { ru: "На рассмотрении", en: "Under review" },
  qc_btn_approved: { ru: "Возврат одобрен", en: "Refund approved" },
  qc_btn_rejected: { ru: "Возврат отменён", en: "Refund declined" },
  qc_approved_notice: {
    ru: "✅ Возврат одобрен. +{n} 🍑\nБаланс: {balance} 🍑",
    en: "✅ Refund approved. +{n} 🍑\nBalance: {balance} 🍑",
  },
  qc_approved_free_undress: {
    ru: "✅ Возврат одобрен. Бесплатное раздевание снова доступно.",
    en: "✅ Refund approved. Free undress is available again.",
  },
  qc_rejected_notice: {
    ru: "Заявка на возврат отклонена.",
    en: "Refund request declined.",
  },

  /** Anti-ban backup links — after first hub + gens 1/3/6/9. */
  /** Reserve / standby bot — only /start reply until cutover. */
  standby_bot_notice: {
    ru: `<b>Этот бот является резервным.</b>

Если вдруг основной заблокируют, то включится этот и подтянется вся информация и возможности студии из старого бота.

Просто держите этот бот включённым на всякий случай, чтобы не потерять.

До переезда на него бот не будет присылать никаких сообщений.`,
    en: `<b>This is a backup bot.</b>

If the main bot gets blocked, this one will take over with all your studio data and features.

Just keep this bot enabled so you don't lose access.

Until cutover, it won't send any messages.`,
  },

  ban_backup_notice: {
    ru: `❗️ <b>БОТ МОГУТ ЗАБЛОКИРОВАТЬ</b> ❗️

Чтобы не потерять, сохрани себе:

📎 Сайт, где всегда актуальная рабочая ссылка 👉 http://pichbitch.live/
💦 Наш чат 👉 https://t.me/+6aVo5HU0Yrc4NjYy`,
    en: `❗️ <b>THE BOT MAY GET BLOCKED</b> ❗️

Save these so you don't lose us:

📎 Always-updated working link 👉 http://pichbitch.live/
💦 Our chat 👉 https://t.me/+6aVo5HU0Yrc4NjYy`,
  },

  gen_insufficient: {
    ru: `Эх, PeachBitch такой битч, что без персиков не работает 😢

Генерация стоит {need}🍑
У тебя на балансе: {balance}🍑

Чтобы пополнить баланс, нажми на кнопку ниже 👇`,
    en: `PeachBitch is such a bitch — no peaches, no magic 😢

Generation costs {need}🍑
Your balance: {balance}🍑

Tap below to top up 👇`,
  },

  topup_prompt: {
    ru: `<b>Сколько персиков хочешь приобрести?</b>

🍑 1 персик = 1 рубль
Минимум — <b>100 🍑</b> (≈ {usdt} USDT по курсу)

Выбери по кнопке или введи число в чате 👇
Дальше покажем сумму в ₽ ($) и способы: СБП / карта / крипта.`,
    en: `<b>How many peaches do you want?</b>

🍑 1 peach = 1 RUB
Minimum — <b>100 🍑</b> (≈ {usdt} USDT at current rate)

Pick a button or type a number 👇
Next: amount in ₽ ($) and SBP / card / crypto.`,
  },

  topup_min_error: {
    ru: "Минимальная сумма для пополнения — 100 🍑 (≈ {usdt} USDT). Введи число от 100.",
    en: "Minimum top-up is 100 🍑 (≈ {usdt} USDT). Enter 100 or more.",
  },

  topup_btn: { ru: "Пополнить баланс 💳", en: "Top up balance 💳" },

  topup_stub: {
    ru: "Оплата скоро будет подключена. Выбрано: {n} 🍑",
    en: "Payments coming soon. Selected: {n} 🍑",
  },

  topup_choose_method: {
    ru: `Сумма: <b>{price}</b>

Выбери способ оплаты:`,
    en: `Amount: <b>{price}</b>

Choose a payment method:`,
  },

  topup_payments_offline: {
    ru: `Сумма: <b>{price}</b>

Платёжный шлюз ещё не подключён на сервере. Напиши в поддержку — или попробуй позже.`,
    en: `Amount: <b>{price}</b>

Payment gateway is not configured yet. Contact support — or try later.`,
  },

  topup_pay_link: {
    ru: `К оплате: <b>{price}</b>
Способ: <b>{method}</b>

Нажми кнопку ниже — откроется форма Cashera. После оплаты персики зачислятся автоматически.`,
    en: `To pay: <b>{price}</b>
Method: <b>{method}</b>

Tap below to open the Cashera form. Peaches credit automatically after payment.`,
  },

  topup_pay_error: {
    ru: "Не удалось создать платёж: {msg}",
    en: "Could not create payment: {msg}",
  },

  topup_paid: {
    ru: "✅ Оплата получена!\n\nЗачислено: <b>{n}</b> 🍑\nБаланс: <b>{balance}</b> 🍑",
    en: "✅ Payment received!\n\nCredited: <b>{n}</b> 🍑\nBalance: <b>{balance}</b> 🍑",
  },

  hub_main: {
    ru: `Ну что, пофантазируем? 😏💦

У тебя на балансе: {balance} 🍑

Порно-студия готова к работе. Сейчас тебе доступно 4 режима:

1) <b>Раздеть по 1 фото</b>{undress_free}

Это пробная функция, не самое высокое качество, как в других режимах. Просто отправляешь фото девушки, а я её раздеваю. Можно получать бесплатные раздевания – заходи в ленту каждый день, листай её 20-30 секунд и там появится кнопка, чтобы забрать бесплатное раздевание.

2) <b>Фотография по образу</b>

Образ создаётся на основе фотографий нужной тебе девушки. Загружаешь минимум 5 фото 🡺 система обучается создавать фото с ней 🡺 генерируешь с ней любые фотки максимального качества и реалистичности

3) <b>Видео по образу</b>

Принцип тот же. Когда образ будет готов, ты сможешь создавать супер-реалистичные видео и порно-фильмы со своей актрисой.

4) <b>Видео по 1 фото</b>

Это быстрый режим. Видео до 12 секунд по готовым шаблонам создаются на основе 1 фотографии, которую ты отправишь

Примеры работы и шаблоны ты можешь посмотреть, выбрав нужный режим по кнопкам ниже или открыв «Студию».`,
    en: `Ready to fantasize? 😏💦

Your balance: {balance} 🍑

The porn studio is ready. You have 4 modes:

1) <b>Undress from 1 photo</b>{undress_free}

Trial mode — not the highest quality vs other modes. Send a girl photo and I undress her. Free undresses: open the feed daily, scroll 20–30 seconds, claim the button when it appears.

2) <b>Photo by look</b>

A look is built from photos of the girl you want. Upload at least 5 photos → the system learns her → generate any photos at max quality and realism

3) <b>Video by look</b>

Same idea. When the look is ready, you can make ultra-realistic videos and porn films with your actress.

4) <b>Video from 1 photo</b>

Fast mode. Up to 12s videos from templates using one photo you send

Browse examples and templates via the buttons below or open the Studio.`,
  },

  hub_undress_free_suffix: {
    ru: ` (🎁 Тебе доступно бесплатное раздевание)`,
    en: ` (🎁 Free undress available)`,
  },

  /** Short caption under welcome media (Telegram limit 1024). Full hub text is a follow-up message. */
  hub_media_caption: {
    ru: `Ну что, пофантазируем? 😏💦\n\nБаланс: {balance} 🍑`,
    en: `Ready to fantasize? 😏💦\n\nBalance: {balance} 🍑`,
  },

  undress_disclaimer: {
    ru: `Раздеть по 1 фото - это пробная функция нашей студии. Раздевание имеет свои ограничения и среднее качество, по сравнению с другими нашими функциями.

Если ты пришёл сюда за настоящим удовольствием и властью, то мы рекомендуем сделать видео по 1 фото, или видео/фото по образу для максимального качества и реализма.

Но если ты хочешь просто попробовать раздеть по 1 фото, то просто нажми кнопку “Хочу раздеть” и я раздену девушку на твоей фотографии за 10-15 секунд.`,
    en: `Undress from 1 photo is a trial studio feature. Undressing has limits and average quality vs our other modes.

If you want real pleasure and control, we recommend Video from 1 photo, or Video/Photo by look for max quality and realism.

To try undress from 1 photo, tap “Want to undress” — I’ll undress the girl in your photo in 10–15 seconds.`,
  },

  undress_want_btn: {
    ru: "Хочу раздеть →",
    en: "Want to undress →",
  },

  undress_price_line: {
    ru: `Стоимость раздевания: {price}🍑`,
    en: `Undress price: {price}🍑`,
  },

  undress_free_line: {
    ru: `Тебе доступно 1 бесплатное раздевание`,
    en: `You have 1 free undress`,
  },

  undress_await_photo: {
    ru: `Отправь фотографию девушки, которую ты хочешь раздеть:

✅Хорошо видно лицо, желательно прямой ракурс
✅Хорошее качество
✅Нет других людей на фото

Просто прикрепи фото и я раздену её`,
    en: `Send a photo of the girl you want undressed:

✅Face clearly visible, preferably front angle
✅Good quality
✅No other people in the photo

Just attach the photo and I’ll undress her`,
  },

  undress_busy: {
    ru: "Раздеваю… ~10–15 сек",
    en: "Undressing… ~10–15 sec",
  },

  undress_success: {
    ru: `Я раздел её!

Но это не лучшее качество, на которое я способен. Попробуй функцию “Видео по 1 фото”, “Видео по образу” или “Фото по образу”. Просто открой студию и в ленте посмотри на примеры, чтобы понять насколько высокое качество я могу делать.

А если хочешь получать бесплатные раздевания, заходи в ленту каждый день, листай её 20-30 секунд и там появится кнопка, чтобы забрать бесплатное раздевание.`,
    en: `I undressed her!

But this isn’t my best quality. Try “Video from 1 photo”, “Video by look”, or “Photo by look”. Open the studio feed for examples of how high I can go.

For free undresses: open the feed daily, scroll 20–30 seconds, and claim the button when it appears.`,
  },

  undress_again_btn: {
    ru: "Хочу ещё раздеть",
    en: "Undress again",
  },

  undress_open_feed_btn: {
    ru: "Открыть ленту",
    en: "Open feed",
  },

  hub_btn_undress: {
    ru: "🍓 Раздеть по 1 фото",
    en: "🍓 Undress from 1 photo",
  },

  /** Appended to hub only if user still has unused studio free photo. */
  hub_main_free_offer: {
    ru: `

🎁 На старте на баланс начислены персики на одно фото с актрисой студии — попробуй и оцени качество.`,
    en: `

🎁 Starter peaches for one studio actress photo are on your balance — try it and check the quality.`,
  },

  hub_btn_video_one: {
    ru: "💦 Видео по 1 фото",
    en: "💦 Video from 1 photo",
  },
  hub_btn_photo_look: {
    ru: "🔥 Фото по образу",
    en: "🔥 Photo by look",
  },
  hub_btn_video_look: {
    ru: "❤️ Видео по образу",
    en: "❤️ Video by look",
  },
  hub_btn_create_look: {
    ru: "Создать свой образ",
    en: "Create your look",
  },
  hub_btn_topup: {
    ru: "Пополнить баланс",
    en: "Top up balance",
  },
  hub_btn_help: {
    ru: "Помощь",
    en: "Help",
  },
  hub_btn_earn: {
    ru: "Зарабатывать",
    en: "Earn",
  },
  hub_btn_back: {
    ru: "⬅️ Назад",
    en: "⬅️ Back",
  },

  hub_open_studio_btn: {
    ru: "Студия",
    en: "Studio",
  },

  hub_guide_btn: {
    ru: "Инструкция, как пользоваться",
    en: "How to use guide",
  },

  /** Unused in chat: reply keyboard is attached via a deleted carrier message. */
  menu_ready_hint: {
    ru: "Меню снизу всегда под рукой 👇",
    en: "Menu is always at the bottom 👇",
  },

  menu_generation: { ru: "📹 Генерация", en: "📹 Generation" },
  menu_characters: { ru: "🟠 Персонажи", en: "🟠 Characters" },
  menu_balance: { ru: "💳 Баланс", en: "💳 Balance" },
  menu_earn: { ru: "💰 Заработать", en: "💰 Earn" },
  menu_community: { ru: "👥 Наше коммьюнити", en: "👥 Our community" },
  menu_help: { ru: "❓ Помощь", en: "❓ Help" },
  menu_main: { ru: "🏠 Главное меню", en: "🏠 Main menu" },
  menu_open_studio: { ru: "🍑 Открыть студию", en: "🍑 Open studio" },
  open_studio_tap: {
    ru: "Открой студию кнопкой ниже 👇",
    en: "Open the studio with the button below 👇",
  },

  community_text: {
    ru: "👥 Залетай в наше коммьюнити — чат, новости и общение:",
    en: "👥 Join our community — chat, news, and people:",
  },
  community_open_btn: {
    ru: "Открыть коммьюнити",
    en: "Open community",
  },

  help_title: {
    ru: `📩 Поддержка: {support}
🔗 Не потеряй бота, если забанят, актуальная версия в чате: https://t.me/+6aVo5HU0Yrc4NjYy

Не понимаешь, как пользоваться ботом? Нажми на кнопку ниже с инструкцией!`,
    en: `📩 Support: {support}
🔗 Don’t lose the bot if it gets banned — current version in the chat: https://t.me/+6aVo5HU0Yrc4NjYy

Not sure how to use the bot? Tap the guide button below!`,
  },

  help_guide_btn: {
    ru: "📖 Инструкция, как пользоваться",
    en: "📖 How to use guide",
  },

  help_rules_btn: {
    ru: "📜 Политика, правила, оферта",
    en: "📜 Policy, rules & offer",
  },

  help_support_btn: {
    ru: "💬 Написать в поддержку",
    en: "💬 Message support",
  },

  help_lang_btn: { ru: "🌐 Сменить язык", en: "🌐 Change language" },

  pick_lang_switch: {
    ru: "🌐 Выбери язык:",
    en: "🌐 Choose language:",
  },

  lang_switched: {
    ru: "Язык: русский 🇷🇺",
    en: "Language: English 🇺🇸",
  },

  balance_fmt: {
    ru: "Баланс: <b>{n}</b> 🍑",
    en: "Balance: <b>{n}</b> 🍑",
  },

  balance_with_topup_hint: {
    ru: "Баланс: <b>{n}</b> 🍑\n\nНажми «Пополнить баланс 💳» чтобы пополнить.",
    en: "Balance: <b>{n}</b> 🍑\n\nTap «Top up balance 💳» to add peaches.",
  },

  earn_text: {
    ru: "💰 <b>Заработать</b>\n\nКомиссия с оборота пополнений приглашённых пользователей (ставка в твоём кабинете).\nВыплата USDT от 30.",
    en: "💰 <b>Earn</b>\n\nCommission on top-ups from users you refer (your rate is in the partner cabinet).\nPayout from 30 USDT.",
  },

  earn_dash: {
    ru: "💰 <b>Партнёрская программа</b>\n\n• Рефералов: <b>{referrals}</b>\n• Покупок: <b>{purchases}</b>\n• Оборот пополнений: <b>{gross}</b> 🍑\n• Твоя доля ({pct}%): <b>{earned}</b> 🍑\n• Баланс к выводу: <b>{balance}</b> 🍑\n\nУсловия: <b>{pct}%</b> с пополнений приглашённых.\nВыплата USDT от 30.\n\nТвоя основная ссылка:\n<code>{link}</code>",
    en: "💰 <b>Partner program</b>\n\n• Referrals: <b>{referrals}</b>\n• Purchases: <b>{purchases}</b>\n• Top-up volume: <b>{gross}</b> 🍑\n• Your share ({pct}%): <b>{earned}</b> 🍑\n• Withdrawal balance: <b>{balance}</b> 🍑\n\nTerms: <b>{pct}%</b> of referred users' top-ups.\nPayout from 30 USDT.\n\nYour main link:\n<code>{link}</code>",
  },

  earn_open_partner_btn: {
    ru: "📊 Открыть партнёрку в Mini App",
    en: "📊 Open partner program in Mini App",
  },

  partner_commission_notice: {
    ru: "Поздравляю! Тебе пришли комиссионные <b>+{n} 🍑</b> от пополнения реферала",
    en: "Congrats! You earned <b>+{n} 🍑</b> commission from a referral top-up",
  },

  gen_pick_kind: {
    ru: "Что сгенерировать?",
    en: "What to generate?",
  },

  welcome_back: {
    ru: "С возвращением! 👇",
    en: "Welcome back! 👇",
  },

  upload_photos: {
    ru: "Пришли 3–5 фото (лицо + тело) для модели.",
    en: "Send 3–5 photos (face + body) for your model.",
  },

  speech_prompt: {
    ru: "🗣 Шаблон с речью. Напиши, что должна сказать модель:",
    en: "🗣 This template has speech. Type what your model should say:",
  },

  speech_slot_prompt: {
    ru: "🗣 Реплика {n}/{total} — {label}\n\nСейчас: «{text}»\n\nНапиши новый текст или нажми «Оставить».",
    en: "🗣 Line {n}/{total} — {label}\n\nCurrent: «{text}»\n\nType a new line or tap Keep.",
  },

  inbox_ack: {
    ru: "📩 Сообщение получили. Ответим здесь, когда сможем.\n\nЕсли хотела меню — нажми кнопку внизу.",
    en: "📩 Got your message. We'll reply here soon.\n\nNeed the menu? Use the buttons below.",
  },

  speech_keep: {
    ru: "⏭ Оставить как есть",
    en: "⏭ Keep as is",
  },

  speech_use_defaults: {
    ru: "✅ Все реплики как в превью",
    en: "✅ Use preview lines",
  },

  speech_confirm: {
    ru: "✅ Подтвердить и дальше",
    en: "✅ Confirm and continue",
  },

  need_photos: {
    ru: "Сначала загрузи минимум 3 фото модели в разделе «Персонажи».",
    en: "Upload at least 3 model photos in «Characters» first.",
  },

  speech_preview: {
    ru: "Реплика: «{line}»\n\nПодтверди или напиши заново.",
    en: "Line: «{line}»\n\nConfirm or type again.",
  },

  speech_done: {
    ru: "🗣 Речь сохранена. Дальше — фото модели.",
    en: "🗣 Speech saved. Next — model photos.",
  },

  generating: {
    ru: "⏳ Генерация запущена…",
    en: "⏳ Generation started…",
  },

  gen_error: {
    ru: "❌ Ошибка: {msg}",
    en: "❌ Error: {msg}",
  },

  discount_note: {
    ru: " (со скидкой −30%)",
    en: " (−30% discount)",
  },

  free_photo_note: {
    ru: " (бесплатно 🎁)",
    en: " (free 🎁)",
  },

  char_list_title: {
    ru: "<b>Персонажи</b>\n\nВыбери модель или создай новую:",
    en: "<b>Characters</b>\n\nPick a model or create a new one:",
  },

  char_new_btn: { ru: "➕ Новый персонаж", en: "➕ New character" },
  char_back_btn: { ru: "◀️ Назад", en: "◀️ Back" },
  char_add_photos_btn: { ru: "📸 Добавить фото", en: "📸 Add photos" },
  char_rename_btn: { ru: "✏️ Переименовать", en: "✏️ Rename" },
  char_lookbook_btn: { ru: "⚙️ Настройки тела", en: "⚙️ Body settings" },

  char_name_prompt: {
    ru: "Как назвать персонажа? (до 40 символов)",
    en: "Character name? (up to 40 chars)",
  },

  char_rename_prompt: {
    ru: "Новое имя персонажа:",
    en: "New character name:",
  },

  char_created: {
    ru: "Персонаж <b>{name}</b> создан ✅",
    en: "Character <b>{name}</b> created ✅",
  },

  char_selected: {
    ru: "Персонаж <b>{name}</b> выбран ✅",
    en: "Character <b>{name}</b> selected ✅",
  },

  char_not_found: {
    ru: "Персонаж не найден.",
    en: "Character not found.",
  },

  char_detail: {
    ru: "👤 <b>{name}</b>\n📸 {n}/{max} фото{ready}\n\nМинимум {min} фото для генерации.",
    en: "👤 <b>{name}</b>\n📸 {n}/{max} photos{ready}\n\nAt least {min} photos to generate.",
  },

  model_ready_suffix: {
    ru: " — готова ✅",
    en: " — ready ✅",
  },

  photo_progress: {
    ru: "📸 Фото {n}/{max}. {hint}",
    en: "📸 Photo {n}/{max}. {hint}",
  },

  photo_need_more: {
    ru: "Нужно ещё {n} фото.",
    en: "Need {n} more photo(s).",
  },

  photo_max: {
    ru: "Максимум {max} фото.",
    en: "Max {max} photos.",
  },

  lb_title: {
    ru: "⚙️ <b>Настройки тела</b> — {name}\n\n{field}: <b>{value}</b>\n\nВыбери параметр:",
    en: "⚙️ <b>Body settings</b> — {name}\n\n{field}: <b>{value}</b>\n\nPick a parameter:",
  },

  lb_pick_field: {
    ru: "⚙️ <b>Настройки тела</b> — {name}\n\nВыбери параметр для тонкой настройки:",
    en: "⚙️ <b>Body settings</b> — {name}\n\nPick a parameter to fine-tune:",
  },

  lb_saved: {
    ru: "✅ Сохранено: {field} → {value}",
    en: "✅ Saved: {field} → {value}",
  },

  lb_custom_prompt: {
    ru: "Введи своё значение для «{field}» (на английском для лучшего результата):",
    en: "Enter custom value for «{field}» (English works best):",
  },

  lb_back_btn: { ru: "◀️ К персонажу", en: "◀️ Back to character" },

  templates_empty: {
    ru: "Шаблоны скоро появятся. Пока открой маркетплейс 👇",
    en: "Templates coming soon. Open the marketplace 👇",
  },
};

export type TgI18nKey = keyof typeof M;

type OverlayRow = { ru: string; en: string };
const copyOverlay: Partial<Record<string, OverlayRow>> = {};

export function setI18nOverlay(
  rows: { slot: string; textRu: string; textEn: string }[],
) {
  for (const key of Object.keys(copyOverlay)) delete copyOverlay[key];
  for (const r of rows) {
    if (!r.textRu && !r.textEn) continue;
    copyOverlay[r.slot] = {
      ru: r.textRu || M[r.slot as TgI18nKey]?.ru || "",
      en: r.textEn || M[r.slot as TgI18nKey]?.en || "",
    };
  }
}

export function t(key: TgI18nKey, locale: TgLocale): string {
  const over = copyOverlay[key];
  if (over?.[locale]) return over[locale];
  const row = M[key];
  return row?.[locale] ?? String(key);
}

export function tFormat(
  key: TgI18nKey,
  locale: TgLocale,
  vars: Record<string, string | number>,
): string {
  let s = t(key, locale);
  for (const [k, v] of Object.entries(vars)) {
    s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

/** Match any locale variant of a menu / action button. */
export function isMenuText(text: string, key: TgI18nKey): boolean {
  return text === t(key, "ru") || text === t(key, "en");
}
