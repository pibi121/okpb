import { AsyncLocalStorage } from "async_hooks";

export type TgBotContext = {
  botInstanceId: string | null;
  username: string;
  token: string;
  telegramBotId: string;
};

const als = new AsyncLocalStorage<TgBotContext>();

export function runWithTgBot<T>(ctx: TgBotContext, fn: () => Promise<T>): Promise<T> {
  return als.run(ctx, fn);
}

export function currentTgBot(): TgBotContext | null {
  return als.getStore() || null;
}

export function currentTgBotToken(): string | null {
  return als.getStore()?.token || null;
}
