import { PoseEvalBoard } from "@/components/pose-eval-board";

export default function PoseEvalPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-medium">Оценка pose-кирпичей (Ref2V)</h2>
        <p className="text-sm text-zinc-600">
          Batch 1–4: оцени <strong>внешность</strong>,{" "}
          <strong>попадание в позу</strong> и <strong>картинку</strong> — плохо
          / средне / хорошо. Выбери лучший вариант A/B и отметь promote для
          сохранения кирпича.
        </p>
      </div>
      <PoseEvalBoard />
    </div>
  );
}
