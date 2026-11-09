import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";
import React from "react";
import { create, act } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

test("right panel removes an inherited bookmark directly without navigating and keeps summaries readable in compact dark mode", async () => {
  const built = await build({ entryPoints: ["client/panel.tsx"], bundle: true, platform: "node", format: "cjs", write: false, external: ["react", "react/jsx-runtime", "@tanstack/react-query"], plugins: [{ name: "host-ui", setup(builder) {
    builder.onResolve({ filter: /^(react-native|@getpaseo\/plugin\/client(?:\/ui)?)$/ }, (args) => ({ path: args.path, namespace: "host" }));
    builder.onLoad({ filter: /.*/, namespace: "host" }, (args) => ({ contents: args.path === "react-native"
      ? 'export const View="View", Text="Text", Pressable="Pressable", Platform={OS:"web"};'
      : args.path.endsWith("/ui") ? 'export const Icon="Icon", ScrollView="ScrollView"; export function Modal(){return null}; Modal.Content="ModalContent";'
      : 'export function useAgent(_id, select) { return select({title:"新对话 B"}); }' }));
  } }], logLevel: "silent" });
  const module: { exports: any } = { exports: {} };
  new Function("module", "exports", "require", built.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const listeners = new Set<() => void>();
  const inherited = { id: "source-bookmark", sourceAgentId: "agent-a", sourceTitle: "原对话 A", role: "assistant", summary: "值得保留的回答摘要" };
  let snapshot: any = { active: { workspaceId: "workspace-a", ownerId: "agent-b", agentId: "agent-b" }, session: { bookmarks: [inherited] }, loading: false, error: null, jumping: null, fork: null };
  let jumps = 0;
  const removals: unknown[] = [];
  const runtime = {
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot() { return snapshot; }, attach() {}, navigation: undefined,
    title() { return "新对话 B"; }, jump() { jumps++; }, clearError() {}, reopenFork() {},
    async remove(ownerId: string, bookmark: unknown) {
      removals.push({ ownerId, bookmark });
      snapshot = { ...snapshot, session: { bookmarks: [] } };
      for (const listener of listeners) listener();
    },
  };
  const colors = { surface0: "#111111", surface1: "#222222", surface2: "#333333", border: "#444444", foreground: "#ffffff", foregroundMuted: "#bbbbbb", accent: "#aabbff", accentForeground: "#000000", statusWarning: "#ffbb55", statusDanger: "#ff7777" };
  const cache = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  let renderer: any;
  try {
    await act(async () => { renderer = create(React.createElement(QueryClientProvider, { client: cache }, React.createElement(module.exports.BookmarkPanel, { runtime, theme: { colors }, layout: { compact: true, platform: "web" }, host: { id: "host-a" }, workspaceId: "workspace-a", params: {}, tab: {} }))); });
    assert.ok(renderer.root.findAllByType("Text").some((node: any) => node.props.children === inherited.summary));
    for (const text of renderer.root.findAllByType("Text")) assert.ok(text.props.style.color, "every text uses a theme foreground color");
    const jump = renderer.root.findAllByType("Pressable").find((node: any) => node.props.accessibilityLabel?.startsWith("跳转到"));
    await act(async () => { jump.props.onPress(); }); assert.equal(jumps, 1);
    jumps = 0;
    const remove = renderer.root.findAllByType("Pressable").find((node: any) => node.props.accessibilityLabel?.startsWith("移除书签"));
    await act(async () => { remove.props.onPress(); });
    assert.equal(jumps, 0, "the remove action does not navigate");
    assert.deepEqual(removals, [{ ownerId: "agent-b", bookmark: inherited }]);
    assert.ok(renderer.root.findAllByType("Text").some((node: any) => node.props.children === "还没有书签"));
  } finally { await act(async () => { renderer?.unmount(); }); cache.clear(); }
});
