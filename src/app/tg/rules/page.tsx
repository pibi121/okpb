"use client";

import { useMemo, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import legalDocs from "@/lib/tg/legal-docs.json";

type TabId = "terms" | "privacy";

function linkify(text: string) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((part, i) => {
    if (/^https?:\/\//.test(part)) {
      return (
        <a key={i} href={part} target="_blank" rel="noreferrer">
          {part}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function paraClass(line: string, index: number): string {
  if (index === 0) return "legal-title";
  if (/^ВАЖНОЕ\b/i.test(line) || /^IMPORTANT\b/i.test(line)) return "legal-warn";
  if (/^\d+\.\s+\S/.test(line) && !/^\d+\.\d+/.test(line)) return "legal-h2";
  if (/^\d+\.\d+/.test(line)) return "legal-h3";
  if (line.startsWith("•") || line.startsWith("—") || line.startsWith("- ")) return "legal-li";
  if (/^©\s/.test(line)) return "legal-meta";
  if (index <= 2) return "legal-meta";
  return "legal-p";
}

function LegalDoc({ paragraphs }: { paragraphs: string[] }) {
  return (
    <article className="legal-doc">
      {paragraphs.map((line, i) => {
        const cls = paraClass(line, i);
        if (cls === "legal-title") return <h1 key={i}>{line}</h1>;
        if (cls === "legal-h2") return <h2 key={i}>{line}</h2>;
        if (cls === "legal-h3") return <h3 key={i}>{linkify(line)}</h3>;
        return (
          <p key={i} className={cls}>
            {linkify(line)}
          </p>
        );
      })}
    </article>
  );
}

function RulesBody() {
  const params = useSearchParams();
  const lang = params.get("lang") === "en" ? "en" : "ru";
  const initialTab: TabId = params.get("tab") === "privacy" ? "privacy" : "terms";
  const [tab, setTab] = useState<TabId>(initialTab);

  const copy = useMemo(
    () =>
      lang === "en"
        ? {
            termsTab: "Terms of Service",
            privacyTab: "Privacy Policy",
            note: "Official Russian text. English translation coming soon.",
          }
        : {
            termsTab: "Соглашение",
            privacyTab: "Конфиденциальность",
            note: null as string | null,
          },
    [lang],
  );

  const paragraphs = tab === "terms" ? legalDocs.terms : legalDocs.privacy;

  return (
    <main className="rules-shell">
      <header className="rules-top">
        <div className="rules-brand">PeachBitch</div>
        <div className="rules-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "terms"}
            className={tab === "terms" ? "is-active" : undefined}
            onClick={() => setTab("terms")}
          >
            {copy.termsTab}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "privacy"}
            className={tab === "privacy" ? "is-active" : undefined}
            onClick={() => setTab("privacy")}
          >
            {copy.privacyTab}
          </button>
        </div>
        {copy.note ? <p className="rules-note">{copy.note}</p> : null}
      </header>

      <LegalDoc paragraphs={paragraphs} />

      <style jsx>{`
        .rules-shell {
          --bg: #070708;
          --fg: #f4f1ec;
          --muted: #8a8680;
          --peach: #ffcab0;
          --apricot: #ff8a5c;
          --hairline: rgba(244, 241, 236, 0.1);
          min-height: 100dvh;
          background: var(--bg);
          color: var(--fg);
          font-family: "Satoshi", system-ui, -apple-system, sans-serif;
          padding: 1.25rem 1.1rem 3rem;
          max-width: 44rem;
          margin: 0 auto;
          line-height: 1.55;
        }
        .rules-top {
          position: sticky;
          top: 0;
          z-index: 5;
          background: linear-gradient(180deg, #070708 70%, rgba(7, 7, 8, 0));
          padding-bottom: 1rem;
          margin: 0 -0.15rem;
        }
        .rules-brand {
          font-size: 0.78rem;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--peach);
          font-weight: 700;
          margin-bottom: 0.85rem;
        }
        .rules-tabs {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.45rem;
          padding: 0.28rem;
          border-radius: 999px;
          background: #121214;
          border: 1px solid var(--hairline);
        }
        .rules-tabs button {
          appearance: none;
          border: 0;
          background: transparent;
          color: var(--muted);
          font: inherit;
          font-size: 0.86rem;
          font-weight: 600;
          padding: 0.65rem 0.5rem;
          border-radius: 999px;
          cursor: pointer;
        }
        .rules-tabs button.is-active {
          color: #1a0f0c;
          background: linear-gradient(135deg, #ffcab0 0%, #ff8a5c 55%, #ff6c85 100%);
        }
        .rules-note {
          margin: 0.75rem 0 0;
          color: var(--muted);
          font-size: 0.78rem;
        }
        :global(.legal-doc h1) {
          font-size: 1.55rem;
          line-height: 1.2;
          margin: 0.4rem 0 0.75rem;
          color: #fff;
          font-weight: 700;
        }
        :global(.legal-doc h2) {
          font-size: 1.05rem;
          margin: 1.6rem 0 0.55rem;
          color: var(--peach);
          font-weight: 700;
        }
        :global(.legal-doc h3) {
          font-size: 0.95rem;
          margin: 0.95rem 0 0.35rem;
          color: #fff;
          font-weight: 600;
        }
        :global(.legal-doc p) {
          margin: 0 0 0.7rem;
          color: rgba(244, 241, 236, 0.88);
          font-size: 0.92rem;
        }
        :global(.legal-doc .legal-meta) {
          color: var(--muted);
          font-size: 0.84rem;
        }
        :global(.legal-doc .legal-warn) {
          color: var(--apricot);
          border: 1px solid rgba(255, 138, 92, 0.35);
          background: rgba(255, 138, 92, 0.08);
          border-radius: 14px;
          padding: 0.85rem 0.95rem;
        }
        :global(.legal-doc .legal-li) {
          padding-left: 0.35rem;
          color: rgba(244, 241, 236, 0.82);
        }
        :global(.legal-doc a) {
          color: var(--peach);
          text-decoration: underline;
          text-underline-offset: 2px;
        }
      `}</style>
    </main>
  );
}

export default function TgRulesPage() {
  return (
    <Suspense
      fallback={
        <main
          style={{
            minHeight: "100dvh",
            background: "#070708",
            color: "#f4f1ec",
            padding: "2rem",
          }}
        >
          …
        </main>
      }
    >
      <RulesBody />
    </Suspense>
  );
}
