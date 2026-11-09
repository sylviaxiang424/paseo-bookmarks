import { defineTranslations, useTranslation } from "@getpaseo/plugin/client";
import { bookmarkErrorKeys } from "../shared/bookmarks";
import { en, zhCN } from "./locales";

export const messages = defineTranslations({ resources: { en, "zh-CN": zhCN } });
export type Translate = ReturnType<typeof useTranslation<typeof en>>["t"];

// Keep error codes in state so an already visible error follows language changes.
// Unknown host/provider errors remain unchanged.
export function localizeError(error: string, t: Translate): string {
  for (const [code, key] of Object.entries(bookmarkErrorKeys)) {
    if (error.includes(code)) return t(key);
  }
  return error;
}
