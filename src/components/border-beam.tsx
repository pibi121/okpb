export function BorderBeam({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
  pulse?: "inner" | "outer";
}) {
  return (
    <div className={`relative ${className}`}>
      <span className="peach-beam-glow rounded-[16px]" aria-hidden />
      <div className="peach-beam overflow-hidden rounded-[16px]">
        <div className="peach-beam-body">{children}</div>
      </div>
    </div>
  );
}
