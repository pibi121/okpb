import { ErosEvalBoard } from "@/components/eros-eval-board";

export default function ErosEvalPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-medium">Оценка Eros / furry свипов</h2>
        <p className="text-sm text-zinc-600">
          Classroom + Park (Ref2V) и оживление фото (I2V). После твоих оценок
          разберём, какие силы LoRA и шаги выиграли — с учётом времени генерации
          и типа пайплайна. Прод-дефолты зафиксированы в{" "}
          <code className="text-xs">data/eros-production.json</code> (Eros BF16 +
          furry; Ref2V 0.75@7, I2V 0.85@6).
        </p>
      </div>
      <ErosEvalBoard />
    </div>
  );
}
