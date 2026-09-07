/**
 * Resolve speech slots for TG video templates (quick video + LoRA→I2V).
 */
import { prisma } from "@/lib/db";
import { parseQuickVideoShotsPlan } from "@/lib/quick-video-prompt";
import {
  extractSpeechSlots,
  legacySpeechSlot,
  speakerLabel,
  speechSlotsFromJson,
  deriveSpeechMaxChars,
  type SpeechSlot,
  templateHasSpeech,
} from "@/lib/speech-slots";

function shotsSourceText(shotsJson: string): string {
  const plan = parseQuickVideoShotsPlan(shotsJson);
  if (plan?.shots?.length) {
    return plan.shots.map((s) => s.legoQuery || "").join("\n\n");
  }
  return shotsJson;
}

export async function resolveVideoTemplateSpeech(templateId: string): Promise<{
  slots: SpeechSlot[];
  hasSpeech: boolean;
  kind: "quick_video" | "lora_i2v" | null;
}> {
  const lora = await prisma.loraI2vTemplate.findFirst({
    where: { id: templateId },
    select: { i2vPrompt: true, stillPrompt: true },
  });
  if (lora) {
    const slots = extractSpeechSlots(lora.i2vPrompt, lora.stillPrompt);
    return {
      slots,
      hasSpeech: templateHasSpeech(slots),
      kind: "lora_i2v",
    };
  }

  const qv = await prisma.quickVideoTemplate.findFirst({
    where: { id: templateId },
    select: { shotsJson: true, hasSpeech: true, notes: true },
  });
  if (!qv) {
    return { slots: [], hasSpeech: false, kind: null };
  }

  // Optional sidecar in notes: <!--speechSlots:[...]-->
  let fromNotes: SpeechSlot[] = [];
  const noteMatch = qv.notes.match(
    /<!--speechSlots:([\s\S]*?)-->/i,
  );
  if (noteMatch?.[1]) {
    fromNotes = speechSlotsFromJson(noteMatch[1].trim());
  }

  const fromPrompt = extractSpeechSlots(shotsSourceText(qv.shotsJson));
  const slots =
    fromNotes.length > 0
      ? fromNotes
      : fromPrompt.length > 0
        ? fromPrompt
        : qv.hasSpeech
          ? legacySpeechSlot()
          : [];

  return {
    slots,
    hasSpeech: templateHasSpeech(slots, qv.hasSpeech),
    kind: "quick_video",
  };
}

/** Public DTO for Mini App / bot. */
export function speechSlotsPublicDto(slots: SpeechSlot[], locale: "ru" | "en") {
  return slots.map((s, i) => ({
    id: s.id,
    speaker: s.speaker,
    lang: s.lang,
    text: s.text,
    maxChars: s.maxChars ?? deriveSpeechMaxChars(s.text),
    label:
      s.label ||
      `${speakerLabel(s.speaker, locale)}${slots.length > 1 ? ` ${i + 1}` : ""}`,
  }));
}
