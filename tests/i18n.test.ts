import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { createTestI18n, translationModule } from "./host-translations";

test("registered labels follow the presenting app's live locale, with independent clients and English fallback", async () => {
  const built = await build({ entryPoints: ["index.client.tsx"], bundle: true, platform: "node", format: "cjs", write: false,
    external: ["react", "react/jsx-runtime", "@tanstack/react-query", translationModule], plugins: [{ name: "host", setup(builder) {
      builder.onResolve({ filter: /^(react-native|@getpaseo\/plugin\/client(?:\/ui)?)$/ }, (args) => ({ path: args.path, namespace: "host" }));
      builder.onLoad({ filter: /.*/, namespace: "host" }, (args) => ({ contents: args.path === "react-native"
        ? 'export const View="View", Text="Text", Pressable="Pressable", Platform={OS:"web"};'
        : args.path.endsWith("/ui") ? 'export const Icon="Icon", ScrollView="ScrollView"; export function Modal(){return null}; Modal.Content="ModalContent";'
        : `export { defineTranslations, useTranslation } from ${JSON.stringify(translationModule)}; export function useAgent() {}` }));
    } }], logLevel: "silent" });
  const compiled: { exports: any } = { exports: {} };
  new Function("module", "exports", "require", built.outputFiles[0].text)(compiled, compiled.exports, createRequire(import.meta.url));
  const install = (locale: string, emptyDirectory = false) => {
    const i18n = createTestI18n(locale), registrations: Record<string, any> = {};
    const registration = (kind: string) => (value: any) => { registrations[kind] = value; return { remove() {} }; };
    const cleanup = compiled.exports.default({
      i18n: i18n.runtime,
      addWorkspacePanel(value: any) { registrations.panel = value; return () => {}; },
      addCommandCenterItem(value: any) { registrations.command = value; return () => {}; },
      addHeaderButton: registration("header"),
      rpc: async () => ({ bookmarks: [] }),
      paseo: { hosts: { async list() { return { self: { serverId: "host-a" } }; } }, agents: { ref() { return { timeline: { async refetch() { return { entries: [] }; } } }; }, async list() { return { subscription: { release() {}, subscribe(listener: any) {
        listener.snapshot({ entries: emptyDirectory ? [] : [{ agent: { id: "agent-a", workspaceId: "workspace-a", title: "Original title" } }], pageInfo: { hasMore: false } });
      } } }; } } },
    });
    return { i18n, registrations, cleanup, runtime: registrations.panel.Component({}).props.runtime };
  };
  const desktop = install("zh-CN"), browser = install("en"), archived = install("en", true);
  await Promise.resolve();
  try {
    const labels = desktop.registrations;
    assert.equal(typeof labels.panel.title, "object", "registrations retain translatable references");
    assert.equal(desktop.i18n.runtime.resolve(labels.panel.title), "书签");
    assert.equal(desktop.i18n.runtime.resolve(labels.command.title), "打开对话书签");
    desktop.i18n.setLocale("en");
    assert.equal(desktop.i18n.runtime.resolve(labels.panel.title), "Bookmarks");
    assert.equal(desktop.i18n.runtime.resolve(labels.header.button.title), "Open conversation bookmarks");
    assert.equal(desktop.i18n.runtime.resolve(labels.header.button.label), "Bookmarks");
    desktop.i18n.setLocale("zh-CN");
    assert.equal(browser.i18n.runtime.resolve(browser.registrations.panel.title), "Bookmarks", "each app keeps its own language");
    desktop.i18n.setLocale("fr");
    assert.equal(desktop.i18n.runtime.resolve(labels.panel.title), "Bookmarks");
    assert.equal(desktop.i18n.runtime.locale, "fr", "fallback does not override the host's locale");
    assert.equal(archived.registrations.header, undefined);
    archived.runtime.select({ serverId: "host-a", workspaceId: "workspace-a", ownerId: "archived-a", agentId: "archived-a" });
    assert.equal(archived.registrations.header.workspaceId, "workspace-a", "an active archived chat gets its header even with an empty directory");
    desktop.runtime.select({ serverId: "host-a", workspaceId: "workspace-a", ownerId: "agent-a", agentId: "agent-a" });
    assert.equal(desktop.runtime.title("agent-a"), "Original title", "context discovery cannot overwrite a known title");
  } finally {
    desktop.cleanup(); browser.cleanup(); archived.cleanup(); desktop.i18n.runtime.dispose(); browser.i18n.runtime.dispose(); archived.i18n.runtime.dispose();
  }
});
