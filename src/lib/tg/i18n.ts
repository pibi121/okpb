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

  /** Start pitch — always shown in Russian first (PDF). */
  start_pitch: {
    ru: `🔐 <code>PlaVER</code>

🍑<b>С Peachbitch ты воплотишь все свои фантазии</b>. Без ограничений, без цензуры, с тотальной защитой конфиденциальности!

Просто загружаешь фотографию своего персонажа и творишь с ним всё, на что хватит фантазии и смелости 🤯💦

— Реалистичные фото и видео 18+
— Маркетплейс готовых шаблонов на любой вкус
— Высочайшее качество, как будто сняли вживую

<b>Для начала, выбери язык 👇</b>
<b>(Select a language)</b>`,
    en: `🔐 <code>PlaVER</code>

🍑<b>With Peachbitch you can bring every fantasy to life</b>. No limits, no censorship, total privacy!

Just upload a photo of your character and create anything your imagination dares 🤯💦

— Realistic 18+ photos & videos
— Marketplace of ready-made templates
— Top quality, as if shot live

<b>Choose your language 👇</b>
<b>(Select a language)</b>`,
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

  welcome_after_rules: {
    ru: `<b>Добро пожаловать в PeachBitch</b> — место, после которого ты забудешь адреса всех сайтов 🔞🍓⬛️🟧 и станешь режиссёром своих удовольствий!

Что можно в этом боте?

1. <b>Бесплатно</b> сгенерировать фото на актрисах студии — проверить качество
2. Создать <b>реалистичные фото</b> со своей моделью (после обучения)
3. <b>Оживить</b> фото или снять <b>видео</b> с сюжетами, позами и диалогами

📸 <b>Нужны фото?</b> Зайди в маркетплейс персонажей → выбери актрису студии → шаблон → кадр за ~30 секунд. Когда убедишься в качестве — создай <b>свою</b> модель в «Персонажи» (от 5 фото, обучение ~2 часа).

🎬 <b>Нужно видео?</b> «Генерация» → «Видео» → шаблон → от 1 фото модели → готово через несколько минут. <i>Обучать персонажа для видео не нужно.</i>`,
    en: `<b>Welcome to PeachBitch</b> — forget every other site 🔞🍓 and become the director of your fantasies!

What you can do:

1. <b>Free</b> photos with studio actresses — see the quality
2. <b>Realistic photos</b> with your own model (after training)
3. <b>Animate</b> photos or shoot <b>videos</b> with plots, poses & dialogue

📸 <b>Photos?</b> Open the cast marketplace → pick a studio actress → template → ~30 sec. When you're sold — create <b>your</b> model in «Characters» (5+ photos, ~2h training).

🎬 <b>Video?</b> «Generation» → «Video» → template → from 1 photo → ready in minutes. <i>No character training required for video.</i>`,
  },

  welcome_free_push: {
    ru: `<b>Просто попробуй бесплатно!</b> Фото с актрисами студии 👇

1. Перейди в маркетплейс моделей
2. Выбери понравившуюся актрису
3. Выбери позу или действие из шаблона
4. Получи готовое фото за ~30 секунд

Так ты поймёшь уровень качества PeachBitch — и потом сможешь настроить <b>своего</b> персонажа без ограничений и цензуры.`,
    en: `<b>Try it free!</b> Photos with studio actresses 👇

1. Open the models marketplace
2. Pick an actress you like
3. Choose a pose or scene template
4. Get your photo in ~30 seconds

See PeachBitch quality first — then set up <b>your own</b> character with no limits.`,
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

<b>Акция!</b> Оплати и запусти обучение в течение 30 минут — получи <b>5 генераций фото</b> в подарок.

На балансе должно быть от {price}🍑. У тебя сейчас: <b>{balance}🍑</b>.`,
    en: `Character training (5–20 photos): <b>{price}🍑</b>
(one-time — then generate forever)

<b>Promo!</b> Pay and start training within 30 minutes — get <b>5 free photo</b> generations.

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

  gen_kind_photo_btn: { ru: "Фото 🔞", en: "Photo 🔞" },
  gen_kind_video_btn: { ru: "Видео 🍓", en: "Video 🍓" },

  gen_pick_template: {
    ru: `Теперь выбери первую позу и сюжет, который хочешь увидеть на {kind}. Можешь кликнуть, посмотреть пример и принять решение. Или перейди в «Маркетплейс», чтобы пролистать ленту шаблонов.`,
    en: `Pick the first pose and scene for {kind}. Tap to preview. Or open «Marketplace» to scroll templates.`,
  },

  gen_kind_photo_label: { ru: "фотографии", en: "your photo" },
  gen_kind_video_label: { ru: "видео", en: "your video" },

  marketplace_btn: { ru: "🍑 Маркетплейс", en: "🍑 Marketplace" },
  gen_page_prev: { ru: "◀️", en: "◀️" },
  gen_page_next: { ru: "▶️", en: "▶️" },

  gen_confirm_pose: {
    ru: `Выбранная поза: <b>{title}</b>

Стоимость генерации: {price}

Модель: <b>{name}</b>
Выбери актрису ниже и нажми «Сгенерировать».`,
    en: `Selected pose: <b>{title}</b>

Generation cost: {price}

Model: <b>{name}</b>
Pick an actress below, then tap Generate.`,
  },

  gen_confirm_video_pose: {
    ru: `Выбранная поза: <b>{title}</b>

Стоимость: {price}

Дальше загрузи фото модели (или выбери сохранённую 🎬) — подготовка модели не нужна.`,
    en: `Selected pose: <b>{title}</b>

Cost: {price}

Next upload model photos (or pick a saved 🎬) — no model setup needed.`,
  },

  gen_confirm_video_best: {
    ru: `✨ <b>Макс. качество</b>

Поза: <b>{title}</b>
Стоимость: {price}

Этот формат работает <b>только с обученной моделью</b> (твоя или актриса студии). Обычное фото «с телефона» здесь не подойдёт — лицо держится за счёт подготовки.`,
    en: `✨ <b>Max quality</b>

Pose: <b>{title}</b>
Cost: {price}

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
    ru: "{price} 🍑 (применена скидка −30%)",
    en: "{price} 🍑 (−30% discount applied)",
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

  gen_success: {
    ru: "<b>😍 {kind} готово!</b>\n\nХочешь попробовать сгенерировать ещё что-то?",
    en: "<b>😍 {kind} is ready!</b>\n\nWant to generate something else?",
  },

  gen_success_photo: { ru: "Фото", en: "Photo" },
  gen_success_video: { ru: "Видео", en: "Video" },

  gen_again_photo_btn: { ru: "Сгенерировать фото", en: "Generate photo" },
  gen_again_video_btn: { ru: "Сгенерировать видео", en: "Generate video" },
  gen_to_hub_btn: { ru: "В главное меню", en: "Main menu" },

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

🍑 1 персик = 1 рубль ({usdt}$ по актуальному курсу)

Выбери по кнопке или введи число в чате 👇`,
    en: `<b>How many peaches do you want?</b>

🍑 1 peach = 1 RUB ({usdt}$ at current rate)

Pick a button or type a number 👇`,
  },

  topup_min_error: {
    ru: "Минимальная сумма для пополнения — 100 🍑 ({usdt}$). Введи число от 100.",
    en: "Minimum top-up is 100 🍑 ({usdt}$). Enter 100 or more.",
  },

  topup_btn: { ru: "Пополнить баланс 💳", en: "Top up balance 💳" },

  topup_stub: {
    ru: "Оплата скоро будет подключена. Выбрано: {n} 🍑",
    en: "Payments coming soon. Selected: {n} 🍑",
  },

  hub_main: {
    ru: `Ну что, пофантазируем? 😏💦

У тебя на балансе: {balance}🍑

📹 <b>Нажми на кнопку "Генерация",</b> чтобы сгенерировать фото или видео

🟠 <b>Нажми на кнопку "Персонажи",</b> чтобы выбрать из списка того персонажа, с которым хочешь сделать следующее фото или обучить PeachBitch новой модели для фото. Для видео персонажа не нужно создавать — просто перед генерацией отправь фото того человека, с которым хочешь сделать видео.

💳 <b>Нажми на кнопку "Баланс", </b>чтобы проверить или пополнить удобным способом`,
    en: `Ready to fantasize? 😏💦

Your balance: {balance}🍑

📹 <b>Tap "Generation"</b> to create a photo or video

🟠 <b>Tap "Characters"</b> to pick who to use for photos or create a new model. For video you don't need a trained character — just send reference photos before generating.

💳 <b>Tap "Balance"</b> to check or top up`,
  },

  menu_generation: { ru: "📹 Генерация", en: "📹 Generation" },
  menu_characters: { ru: "🟠 Персонажи", en: "🟠 Characters" },
  menu_balance: { ru: "💳 Баланс", en: "💳 Balance" },
  menu_earn: { ru: "💰 Заработать", en: "💰 Earn" },
  menu_community: { ru: "👥 Наше коммьюнити", en: "👥 Our community" },
  menu_help: { ru: "❓ Помощь", en: "❓ Help" },
  menu_main: { ru: "🏠 Главное меню", en: "🏠 Main menu" },

  community_text: {
    ru: "👥 Залетай в наше коммьюнити — чат, новости и общение:",
    en: "👥 Join our community — chat, news, and people:",
  },
  community_open_btn: {
    ru: "Открыть коммьюнити",
    en: "Open community",
  },

  help_title: {
    ru: `<b>Помощь</b>

📩 Поддержка: {support}
🔗 Резервы: {reserves}

Политика, правила и оферта — в кнопке ниже.
Язык интерфейса можно сменить кнопкой 👇`,
    en: `<b>Help</b>

📩 Support: {support}
🔗 Backups: {reserves}

Policy, rules & offer — button below.
Change language with the button 👇`,
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
    ru: "💰 <b>Заработать</b>\n\n50% с оборота пополнений приглашённых пользователей.\nВыплата USDT от 30.",
    en: "💰 <b>Earn</b>\n\n50% of top-ups from users you refer.\nPayout from 30 USDT.",
  },

  earn_dash: {
    ru: "💰 <b>Партнёрская программа</b>\n\n• Рефералов: <b>{referrals}</b>\n• Покупок: <b>{purchases}</b>\n• Оборот пополнений: <b>{gross}</b> 🍑\n• Твоя доля (50%): <b>{earned}</b> 🍑\n• Баланс к выводу: <b>{balance}</b> 🍑\n\nУсловия: <b>50%</b> с пополнений приглашённых.\nВыплата USDT от 30.\n\nТвоя основная ссылка:\n<code>{link}</code>",
    en: "💰 <b>Partner program</b>\n\n• Referrals: <b>{referrals}</b>\n• Purchases: <b>{purchases}</b>\n• Top-up volume: <b>{gross}</b> 🍑\n• Your share (50%): <b>{earned}</b> 🍑\n• Withdrawal balance: <b>{balance}</b> 🍑\n\nTerms: <b>50%</b> of referred users' top-ups.\nPayout from 30 USDT.\n\nYour main link:\n<code>{link}</code>",
  },

  earn_open_partner_btn: {
    ru: "📊 Открыть партнёрку в Mini App",
    en: "📊 Open partner program in Mini App",
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
    ru: "🗣 Реплика {n}/{total} — {label} (язык: {lang})\n\nСейчас: «{text}»\n\nНапиши новый текст или нажми «Оставить».\nЧтобы сменить язык: /lang ru или /lang en",
    en: "🗣 Line {n}/{total} — {label} (lang: {lang})\n\nCurrent: «{text}»\n\nType a new line or tap Keep.\nChange language: /lang ru or /lang en",
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
