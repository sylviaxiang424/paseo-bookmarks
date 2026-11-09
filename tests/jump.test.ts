import { createTestI18n } from "./host-translations";
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { Window } from "happy-dom";

const adapterFactory = build({ entryPoints: ["client/web.ts"], bundle: true, platform: "node", format: "cjs", write: false,
  plugins: [{ name: "host", setup(builder) {
    builder.onResolve({ filter: /^react-native$/ }, () => ({ path: "host", namespace: "stub" }));
    builder.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: 'export const Platform = { OS: "web" };' }));
  } }], logLevel: "silent" }).then((bundled) => {
  const compiled: { exports: any } = { exports: {} };
  new Function("module", "exports", "require", bundled.outputFiles[0].text)(compiled, compiled.exports, createRequire(import.meta.url));
  return compiled.exports;
});
const target = { id: "bookmark", messageId: "message-9", aliases: ["message-9"], sourceAgentId: "agent-a", sourceWorkspaceId: "workspace-a", seq: 9, epoch: "epoch-a", role: "assistant", summary: "目标回答" };
const context = { agentId: "agent-a", serverId: "host-a", workspaceId: "workspace-a" };

async function fixture(run: (host: any) => Promise<void>) {
  const factory = await adapterFactory;
  const window = new Window();
  const previous = { document: (globalThis as any).document, MutationObserver: (globalThis as any).MutationObserver };
  Object.assign(globalThis, { document: window.document, MutationObserver: window.MutationObserver });
  const scheduled: ReturnType<typeof setTimeout>[] = [];
  const later = (callback: () => void, ms: number) => scheduled.push(setTimeout(callback, ms));
  const scrolls: any[] = [];
  const createScroll = () => {
    const scroll = window.document.createElement("div"); scroll.setAttribute("data-testid", "agent-chat-scroll");
    scroll.getClientRects = () => [{ width: 500, height: 300 }] as any;
    scroll.getBoundingClientRect = () => ({ left: 0, right: 500, top: 0, bottom: 300, width: 500, height: 300 }) as any;
    (scroll as any).__reactFiber$test = { memoizedProps: context, child: { memoizedProps: {} } };
    window.document.body.append(scroll); scrolls.push(scroll); return scroll;
  };
  let scrolled = 0;
  const addRow = (scroll: any, id = "message-9", epoch = "epoch-a") => {
    const row = window.document.createElement("div"); row.setAttribute("data-history-row-id", id); row.setAttribute("data-message-id", id);
    (row as any).__reactProps$test = { children: { props: { item: { kind: "assistant_message", id, text: "目标回答", timelineCursor: { seq: 9, epoch } } } } };
    let top = 450;
    row.getClientRects = () => [{ width: 500, height: 30 }] as any;
    row.getBoundingClientRect = () => ({ left: 0, right: 500, top, bottom: top + 30, width: 500, height: 30 }) as any;
    row.scrollIntoView = () => { scrolled++; top = 40; };
    scroll.append(row); return row;
  };
  const i18n = createTestI18n();
  const adapter = factory.createWebAdapter({ t: i18n.t, accepts: (ctx: any) => ctx.serverId === "host-a", context() {}, bookmarks: () => [], fork() {}, title: () => "原对话", toggle: async () => {}, prompt() {}, error(message: string) { throw new Error(message); } });
  try { await run({ adapter, createScroll, addRow, later, window, scrolled: () => scrolled }); }
  finally { adapter.dispose(); i18n.runtime.dispose(); for (const timer of scheduled) clearTimeout(timer); Object.assign(globalThis, previous); await window.happyDOM.close(); }
}

test("a mounted message locates without relying on the outline's readiness", () => fixture(async ({ adapter, createScroll, addRow, scrolled }) => {
  addRow(createScroll());
  assert.equal(await adapter.jump(target), true);
  assert.equal(scrolled(), 1);
}));

test("late outline registration and an initially unready prompt index recover automatically", () => fixture(async ({ adapter, createScroll, addRow, later }) => {
  const scroll = createScroll(); let calls = 0;
  later(() => { scroll.__reactFiber$test.child.memoizedProps = { onJumpToPrompt() { if (++calls === 2) addRow(scroll); } }; }, 100);
  assert.equal(await adapter.jump(target), true);
  assert.ok(calls >= 2, "an ignored call before the index was ready must be retried");
}));

test("a history viewport remount during navigation is reacquired", () => fixture(async ({ adapter, createScroll, addRow, later }) => {
  const old = createScroll(); let replacement: any;
  old.__reactFiber$test.child.memoizedProps = { onJumpToPrompt() {
    old.remove(); replacement = createScroll();
    replacement.__reactFiber$test.child.memoizedProps = { onJumpToPrompt() { if (!replacement.querySelector('[data-message-id]')) addRow(replacement); } };
  } };
  assert.equal(await adapter.jump(target), true);
  assert.ok(replacement.querySelector('[data-message-id="message-9"]'));
}));

test("the native message reveal path expands folded content even without an outline callback", () => fixture(async ({ adapter, createScroll, addRow }) => {
  const scroll = createScroll(); let revealed = "", nativeScroll = "";
  const item = { kind: "assistant_message", id: "host-row-9", messageId: "message-9", text: "目标回答", timelineCursor: { epoch: "epoch-a", seq: 9 } };
  scroll.__reactFiber$test.return = { memoizedProps: { ...context, epoch: "epoch-a", items: [item],
    revealLoadedMessage(id: string) { revealed = id; if (!scroll.querySelector('[data-message-id]')) addRow(scroll, "host-row-9"); },
    viewportRef: { current: { scrollToMessage(id: string) { nativeScroll = id; scroll.querySelector('[data-message-id]')?.scrollIntoView(); } } },
  } };
  assert.equal(await adapter.jump(target), true);
  assert.equal(revealed, "host-row-9"); assert.equal(nativeScroll, "host-row-9");
}));

test("a stale epoch cannot select a different message that reused the seq", () => fixture(async ({ adapter, createScroll, addRow, later }) => {
  const scroll = createScroll(); const stale = addRow(scroll, "wrong-message", "epoch-old");
  later(() => { stale.remove(); addRow(scroll); }, 150);
  scroll.__reactFiber$test.child.memoizedProps = { onJumpToPrompt() {} };
  assert.equal(await adapter.jump(target), true);
  assert.equal(stale.getBoundingClientRect().top, 450, "the stale row must never be scrolled");
}));

test("disposing a pending jump cancels retries and leaves no highlight", () => fixture(async ({ adapter, createScroll, later, window }) => {
  const scroll = createScroll(); scroll.__reactFiber$test.child.memoizedProps = { onJumpToPrompt() {} };
  later(() => adapter.dispose(), 100);
  assert.equal(await adapter.jump(target), false);
  assert.equal(window.document.querySelector('.pb-message-highlight'), null);
}));
