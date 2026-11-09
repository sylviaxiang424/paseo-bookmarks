import { fileURLToPath } from "node:url";
import { defineTranslations, PluginTranslationRuntime } from "../node_modules/@getpaseo/plugin/dist/client/translations.js";
import { en, zhCN } from "../client/locales";

// Exercise Paseo's actual locale resolution/hooks without importing native UI.
export { PluginTranslationProvider } from "../node_modules/@getpaseo/plugin/dist/client/translations.js";
export const translationModule = fileURLToPath(new URL("../node_modules/@getpaseo/plugin/dist/client/translations.js", import.meta.url));
export function createTestI18n(initial = "zh-CN") {
  let locale = initial;
  const listeners = new Set<() => void>();
  const runtime = new PluginTranslationRuntime({ getLocale: () => locale, subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; } });
  const messages = defineTranslations({ resources: { en, "zh-CN": zhCN } });
  return {
    runtime,
    t: (key: any, ...args: any[]) => runtime.t(messages, key, ...args),
    setLocale(next: string) { locale = next; for (const listener of listeners) listener(); },
  };
}
