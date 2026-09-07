/**
 * Run work after the HTTP response when inside a Next.js request.
 * Falls back to immediate execution for TG bot, CLI, and Railway workers.
 */
import { after } from "next/server";

export function scheduleAfterResponse(fn: () => void | Promise<void>): void {
  const run = () => {
    void Promise.resolve(fn()).catch((err) => {
      console.error(
        "[schedule-after] background task failed:",
        err instanceof Error ? err.message : err,
      );
    });
  };

  try {
    after(run);
  } catch {
    run();
  }
}
