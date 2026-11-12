import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { Window } from "happy-dom";
import { QueryClient } from "@tanstack/react-query";
import { createTestI18n, translationModule } from "./host-translations";

const compiled = build({ entryPoints: ["client/runtime.ts"], bundle: true, platform: "node", format: "cjs", write: false,
  plugins: [{ name: "host", setup(builder) {
    builder.onResolve({ filter: /^@getpaseo\/plugin\/client$/ }, () => ({ path: translationModule, external: true }));
    builder.onResolve({ filter: /^react-native$/ }, () => ({ path: "host", namespace: "stub" }));
    builder.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: 'export const Platform = { OS: "web" };' }));
  } }], logLevel: "silent" }).then((built) => {
  const module = { exports: {} as any };
  new Function("module", "exports", "require", built.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
  return module.exports;
});

const bookmark = { id: "bookmark-a", sourceAgentId: "agent-a", sourceWorkspaceId: "workspace", messageId: "answer-a", aliases: ["answer-a"], seq: 2, epoch: "epoch", role: "assistant", summary: "source answer", createdAt: "2026-11-10T00:00:00Z" };
const until = async (check: () => boolean) => {
  for (let i = 0; i < 70; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("state transition did not settle");
};
const deferred = () => {
  let resolve!: (value: any) => void, reject!: (reason: Error) => void;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};

async function fixture(run: (host: any) => Promise<void>) {
  const { BookmarkRuntime } = await compiled;
  const window = new Window();
  const previous = { document: (globalThis as any).document, MutationObserver: (globalThis as any).MutationObserver };
  Object.assign(globalThis, { document: window.document, MutationObserver: window.MutationObserver });
  const input = window.document.createElement("div"), scroll = window.document.createElement("div");
  input.dataset.testid = "message-input-root"; scroll.dataset.testid = "agent-chat-scroll";
  for (const node of [input, scroll]) {
    node.getClientRects = () => [{ width: 500, height: 300 }] as any;
    node.getBoundingClientRect = () => ({ left: 0, right: 500, top: 0, bottom: 300, width: 500, height: 300 }) as any;
  }
  let runtime: any;
  const show = (agentId: string, paneId = "pane-1", focused = true) => {
    const props = { agentId, paneId, isPaneFocused: focused, workspaceId: "workspace", serverId: "host" };
    (input as any).__reactFiber$test = { memoizedProps: props };
    (scroll as any).__reactFiber$test = { memoizedProps: props };
    window.document.body.append(input, scroll);
    scroll.replaceChildren(window.document.createElement("span"));
  };
  show("agent-b");
  let readGate: ReturnType<typeof deferred> | undefined;
  let reads = 0;
  const canonical = { epoch: "epoch", hasOlder: false, error: null, entries: [{ seqStart: 2, item: { type: "assistant_message", messageId: "answer-a", text: "source answer" } }] };
  const stored = { bookmarks: [bookmark] };
  const i18n = createTestI18n();
  const client = { i18n: i18n.runtime, openPanel() {}, rpc: async () => stored,
    paseo: { agents: { ref: (id: string) => ({ refresh: async () => ({ id }), timeline: { refetch: async () => {
      if (id !== "agent-a") return { ...canonical, entries: [] };
      reads++;
      return readGate ? readGate.promise : canonical;
    } } }) } } };
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  runtime = new BookmarkRuntime(client);
  const opened: string[] = [];
  runtime.navigation = { openAgent({ agentId }: { agentId: string }) { opened.push(agentId); show(agentId); } };
  try {
    runtime.attach(cache, "host");
    await until(() => runtime.getSnapshot().session.bookmarks.length === 1);
    await run({ runtime, window, input, scroll, show, opened, stored, canonical,
      reads: () => reads, gate: () => (readGate = deferred()) });
  } finally {
    runtime.dispose(); cache.clear(); i18n.runtime.dispose();
    Object.assign(globalThis, previous); await window.happyDOM.close();
  }
}

test("switching during canonical lookup cancels before opening the source, including late errors", () => fixture(async ({ runtime, show, opened, gate, reads }) => {
  const blocked = gate();
  const jumping = runtime.jump(bookmark);
  await until(() => reads() > 0);
  show("agent-c");
  blocked.reject(new Error("late source read failed"));
  await jumping;
  assert.equal(runtime.getSnapshot().active?.agentId, "agent-c", "the error path checks the live selection before reporting");
  assert.equal(runtime.getSnapshot().jumping, null);
  assert.deepEqual(opened, []);
  assert.equal(runtime.getSnapshot().error, null);
}));

test("switching away from a source waiting for its row cancels adapter retries promptly", () => fixture(async ({ runtime, show, opened }) => {
  const jumping = runtime.jump(bookmark);
  await until(() => runtime.getSnapshot().active?.agentId === "agent-a");
  show("agent-c");
  await until(() => runtime.getSnapshot().active?.agentId === "agent-c");
  await Promise.race([jumping, new Promise((_, reject) => setTimeout(() => reject(Error("old jump kept waiting")), 700))]);
  assert.deepEqual(opened, ["agent-a"], "the cancelled job never reopens its source");
  assert.equal(runtime.getSnapshot().jumping, null);
  assert.equal(runtime.getSnapshot().error, null);
}));

test("switching pane for the same conversation also cancels the previous pending jump", () => fixture(async ({ runtime, show, opened }) => {
  show("agent-a");
  await until(() => runtime.getSnapshot().active?.agentId === "agent-a");
  const jumping = runtime.jump(bookmark);
  show("agent-a", "pane-2");
  await until(() => runtime.getSnapshot().active?.paneId === "pane-2");
  await jumping;
  assert.deepEqual(opened, []);
  assert.equal(runtime.getSnapshot().jumping, null);
}));

test("a cancelled lookup cannot clear or report errors into a newer jump", () => fixture(async ({ runtime, show, gate, reads }) => {
  const oldRead = gate(), oldJump = runtime.jump(bookmark);
  await until(() => reads() > 0);
  show("agent-c");
  await until(() => runtime.getSnapshot().active?.agentId === "agent-c");
  const newRead = gate(), newJump = runtime.jump(bookmark);
  await until(() => reads() > 1);
  oldRead.reject(new Error("obsolete lookup failed"));
  await oldJump;
  assert.equal(runtime.getSnapshot().jumping, bookmark.id);
  assert.equal(runtime.getSnapshot().error, null);
  show("agent-b");
  await until(() => runtime.getSnapshot().active?.agentId === "agent-b");
  newRead.resolve({ entries: [] });
  await newJump;
}));

test("closing the last chat clears only the visible session; reopening restores its bookmarks", () => fixture(async ({ runtime, input, scroll, show, stored }) => {
  const before = JSON.stringify(stored);
  input.remove(); scroll.remove();
  await until(() => runtime.getSnapshot().active === null);
  assert.deepEqual(runtime.getSnapshot().session.bookmarks, []);
  assert.equal(runtime.getSnapshot().loading, false);
  show("agent-b");
  await until(() => runtime.getSnapshot().active?.agentId === "agent-b" && runtime.getSnapshot().session.bookmarks.length === 1);
  assert.equal(JSON.stringify(stored), before);
}));

test("a blank focused pane cannot reuse an explicitly unfocused chat's context", () => fixture(async ({ runtime, show }) => {
  show("agent-b", "pane-1", false);
  await until(() => runtime.getSnapshot().active === null);
  assert.deepEqual(runtime.getSnapshot().session.bookmarks, []);
}));

test("tool bookmarks re-resolve the call ID after timeline replacement rather than reuse the old sequence", () => fixture(async ({ runtime, canonical }) => {
  canonical.epoch = "replaced-epoch";
  canonical.entries = [{ seqStart: 45, item: { type: "tool_call", callId: "call-stable", detail: { type: "shell", command: "printf TARGET" }, name: "shell" } }];
  const seen: any[] = [];
  runtime.adapter.jump = async (target: any) => { seen.push(target); return true; };
  await runtime.jump({ ...bookmark, messageId: "call-stable", aliases: ["call-stable"], target: { kind: "tool", toolType: "command" } });
  assert.equal(seen.length, 1); assert.equal(seen[0].messageId, "call-stable");
  assert.equal(seen[0].seq, 45); assert.equal(seen[0].epoch, "replaced-epoch");
  assert.equal(runtime.getSnapshot().error, null);
}));

test("an image removed from a surviving answer cannot jump to its sibling or the parent answer", () => fixture(async ({ runtime, canonical }) => {
  canonical.entries[0].item.text = '![remaining](https://example.test/other.png)';
  let jumped = false; runtime.adapter.jump = async () => { jumped = true; return true; };
  await runtime.jump({ ...bookmark, target: { kind: "image", key: "missing:0" } });
  assert.equal(jumped, false); assert.equal(runtime.getSnapshot().error, "BOOKMARKS_MESSAGE_UNAVAILABLE");
}));
