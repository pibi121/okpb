export function ImageGeneration({
  prompt,
  resolution = "1024 × 1024",
  label = "Генерация…",
  fill = false,
}: {
  prompt?: string | null;
  resolution?: string;
  label?: string;
  fill?: boolean;
}) {
  return (
    <div className={fill ? "ig-wrap ig-wrap--fill" : "ig-wrap"}>
      <div className="ig-canvas" role="img" aria-label={label}>
        <span className="ig-dots" aria-hidden />
        <span className="ig-glow-wash" aria-hidden />
        <span className="ig-glow" aria-hidden />
        <span className="ig-res">{resolution}</span>
      </div>
      <div className="ig-meta">
        <span className="ig-label">{label}</span>
        {prompt ? <span className="ig-prompt">“{prompt}”</span> : null}
      </div>
    </div>
  );
}
