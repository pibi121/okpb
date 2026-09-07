/** Minimal line icons for TG Mini App tab bar (peach apricot stroke). */
export type TgTabIconId =
  | "feed"
  | "gallery"
  | "chars"
  | "photo"
  | "video"
  | "profile";

export function TgTabIcon({
  id,
  active,
}: {
  id: TgTabIconId;
  active?: boolean;
}) {
  const stroke = active ? "currentColor" : "currentColor";
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    "aria-hidden": true as const,
  };
  const s = {
    stroke,
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (id) {
    case "feed":
      return (
        <svg {...common}>
          <rect x="4" y="3.5" width="16" height="17" rx="3" {...s} />
          <path d="M8 8.5h8M8 12h8M8 15.5h5" {...s} />
        </svg>
      );
    case "gallery":
      return (
        <svg {...common}>
          <rect x="3.5" y="5" width="17" height="14" rx="2.5" {...s} />
          <circle cx="9" cy="10" r="1.6" {...s} />
          <path d="M3.5 15.5l4.2-3.2 3.3 2.4 3.5-4.2 6 5" {...s} />
        </svg>
      );
    case "chars":
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="3.2" {...s} />
          <path d="M5.5 19.2c1.2-3.2 3.4-4.7 6.5-4.7s5.3 1.5 6.5 4.7" {...s} />
        </svg>
      );
    case "photo":
      return (
        <svg {...common}>
          <path
            d="M4.5 8.2A2.2 2.2 0 0 1 6.7 6h2l1.2-1.6h4.2L15.3 6h2a2.2 2.2 0 0 1 2.2 2.2v8.6A2.2 2.2 0 0 1 17.3 19H6.7a2.2 2.2 0 0 1-2.2-2.2V8.2z"
            {...s}
          />
          <circle cx="12" cy="12.5" r="3.1" {...s} />
        </svg>
      );
    case "video":
      return (
        <svg {...common}>
          <rect x="3.5" y="6.5" width="12.5" height="11" rx="2.2" {...s} />
          <path d="M16 10.2l4.2-2.4v8.4L16 13.8" {...s} />
        </svg>
      );
    case "profile":
      return (
        <svg {...common}>
          <circle cx="12" cy="9" r="3.4" {...s} />
          <path d="M5 19.5c1.4-3.5 3.8-5.1 7-5.1s5.6 1.6 7 5.1" {...s} />
        </svg>
      );
    default:
      return null;
  }
}
