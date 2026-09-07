"use client";

export function LogoutButton() {
  return (
    <button
      type="button"
      className="text-zinc-500 hover:text-foreground"
      onClick={async () => {
        await fetch("/api/auth?action=logout", { method: "POST" });
        window.location.href = "/";
      }}
    >
      Выйти
    </button>
  );
}
