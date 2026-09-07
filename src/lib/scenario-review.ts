import {
  CONTINUITY_LABELS,
  formatDialogueText,
  getFilmStart,
  planShotsFromGraph,
  wardrobeLabel,
  type ContinuityMode,
  type ScenarioGraph,
} from "./billing";

export type ScenarioReviewResult = {
  synopsis: string;
  beats: { order: number; title: string; text: string; continuity: string }[];
  risks: { level: "low" | "medium" | "high"; shotTitle: string; message: string }[];
  tips: string[];
  creditsCharged: number;
};

/**
 * MVP-проверка сценария без внешнего LLM:
 * читаемый пересказ + риски по правилам непрерывности.
 * Позже можно заменить/дополнить вызовом языковой модели.
 */
export function reviewScenario(
  graph: ScenarioGraph,
  characterNames: Record<string, string> = {},
): { ok: true; review: ScenarioReviewResult } | { ok: false; errors: string[] } {
  const { shots, errors, warnings, start } = planShotsFromGraph(graph, {
    phase: "full",
    characterNames,
  });

  if (errors.length) return { ok: false, errors };

  const nameOf = (id: string) => characterNames[id] || "герой";

  const beats = shots
    .filter((s) => s.workflow !== "transition_only")
    .map((s) => {
      const people = s.characterIds.map(nameOf).join(" и ");
      const where = `${s.location.place}, ${s.location.time_of_day}, ${s.location.lighting}`;
      const wardrobe = s.characterIds
        .map((id) => {
          const st = s.characterStates[id];
          if (!st) return null;
          const note = st.wardrobeNote ? ` (${st.wardrobeNote})` : "";
          return `${nameOf(id)}: ${st.wardrobe}${note}`;
        })
        .filter(Boolean)
        .join("; ");
      const action =
        s.dialogues.length > 0
          ? `диалог: «${formatDialogueText(s.dialogues, characterNames)}»`
          : s.actionType === "dialogue" && s.dialogueText
            ? `диалог: «${s.dialogueText}»`
            : s.actionPrompt || s.actionType;
      const cont = CONTINUITY_LABELS[s.continuity as ContinuityMode] || s.continuity;
      return {
        order: s.orderIndex + 1,
        title: s.title || `Кадр ${s.orderIndex + 1}`,
        text: `${people} · ${where} · камера ${s.camera} · ${action}${
          wardrobe ? ` · вид: ${wardrobe}` : ""
        }`,
        continuity: cont,
      };
    });

  const synopsisParts = [
    start
      ? `Фильм начинается в локации «${start.place}» (${start.timeOfDay}, ${start.lighting}). Язык речи: ${start.language === "en" ? "английский" : "русский"}.`
      : "Старт фильма задан.",
    `В ролях ${beats.length} кадр(ов).`,
    beats
      .map((b) => `${b.order}) ${b.title}: ${b.text} [${b.continuity}]`)
      .join(" "),
  ];

  const risks: ScenarioReviewResult["risks"] = [];

  for (const w of warnings) {
    risks.push({ level: "medium", shotTitle: "Склейка", message: w });
  }

  let prevStates: Record<string, { wardrobe: string }> = {
    ...(start?.characterStates || {}),
  };

  for (const s of shots) {
    if (s.workflow === "transition_only") continue;
    const title = s.title || `Кадр ${s.orderIndex + 1}`;

    if (s.characterIds.length >= 2 && s.camera === "closeup") {
      risks.push({
        level: "medium",
        shotTitle: title,
        message:
          "Двое в кадре и крупный план — лица могут путаться. Лучше средний план или два коротких кадра.",
      });
    }

    if (s.actionType === "intimate" && s.durationSec > 6) {
      risks.push({
        level: "high",
        shotTitle: title,
        message:
          "Интимная сцена длиннее 6 секунд чаще даёт артефакты рук/тела. Разбейте на 2 коротких кадра.",
      });
    }

    if (s.continuity === "hard_cut" && s.orderIndex > 0) {
      risks.push({
        level: "low",
        shotTitle: title,
        message: "Режим «Новая сцена» — стык будет заметнее. Это ок, если так задумано.",
      });
    }

    if (s.actionType === "dialogue" && !s.dialogues.length && !s.dialogueText) {
      risks.push({
        level: "medium",
        shotTitle: title,
        message: "Тип «Диалог», но реплики пустые — озвучка будет слабой.",
      });
    }

    if (s.dialogues.length >= 2) {
      const speakers = new Set(s.dialogues.map((d) => d.characterId));
      if (speakers.size >= 2) {
        risks.push({
          level: "low",
          shotTitle: title,
          message:
            "Две реплики разных героев в одном кадре — следите, чтобы было ясно, кто говорит.",
        });
      }
    }

    for (const id of s.characterIds) {
      const st = s.characterStates[id];
      const prev = prevStates[id];
      if (st && prev && st.wardrobe !== prev.wardrobe) {
        risks.push({
          level: "low",
          shotTitle: title,
          message: `${nameOf(id)}: вид меняется «${wardrobeLabel(prev.wardrobe)}» → «${wardrobeLabel(st.wardrobe)}».`,
        });
      }
    }

    if (s.continuity === "continue" && s.orderIndex > 0) {
      risks.push({
        level: "low",
        shotTitle: title,
        message:
          "«Продолжить сцену»: система возьмёт последний кадр предыдущего видео и тот же эталон места.",
      });
    }

    prevStates = { ...prevStates, ...s.characterStates };
  }

  const hasLocationPhoto = Boolean(start?.locationRefUrl);
  if (!hasLocationPhoto) {
    risks.push({
      level: "low",
      shotTitle: "Место",
      message:
        "Фото места не загружено. Эталон локации возьмём из первой удачной картинки кадра — сначала сделайте «Показать кадры».",
    });
  }

  const tips = [
    "Сначала нажмите «Показать кадры», утвердите или переделайте отдельные кадры, потом «Оживить фильм».",
    "В кадре укажите, кто говорит — голос берётся из Старта для этого героя.",
    "Меняйте одежду/вид героя между кадрами, если сцена это требует (рубашка снята, полотенце и т.д.).",
    "Следите за полоской «длина фильма» — лимит мини-фильма 60 секунд.",
  ];

  return {
    ok: true,
    review: {
      synopsis: synopsisParts.join(" "),
      beats,
      risks,
      tips,
      creditsCharged: 50,
    },
  };
}
