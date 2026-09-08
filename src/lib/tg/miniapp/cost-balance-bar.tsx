"use client";

import { useRouter } from "next/navigation";

type Props = {
  cost: number;
  balance: number;
  locale?: "ru" | "en";
  /** Close mini app and open bot top-up */
  onTopup?: () => void;
};

/** Cost vs balance strip after picking a template. */
export function TgCostBalanceBar({
  cost,
  balance,
  locale = "ru",
  onTopup,
}: Props) {
  const router = useRouter();
  const short = balance < cost;
  const ru = locale === "ru";

  return (
    <div className={`tg-cost-bar${short ? " tg-cost-bar--short" : ""}`}>
      <div className="tg-cost-bar-row">
        <span>{ru ? "Стоимость генерации" : "Generation cost"}</span>
        <strong>
          {cost} 🍑
        </strong>
      </div>
      <div className="tg-cost-bar-row">
        <span>{ru ? "У вас на балансе" : "Your balance"}</span>
        <strong className={short ? "tg-cost-bar-warn" : ""}>
          {balance} 🍑
        </strong>
      </div>
      {short ? (
        <button
          type="button"
          className="tg-primary-btn"
          style={{ width: "100%", marginTop: "0.55rem" }}
          onClick={() => {
            if (onTopup) onTopup();
            else router.push("/tg/profile");
          }}
        >
          {ru ? "Пополнить баланс" : "Top up balance"}
        </button>
      ) : null}
    </div>
  );
}
