import { createTestI18n, translationModule } from "./host-translations";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { Window } from "happy-dom";
import { QueryClient } from "@tanstack/react-query";
import { BookmarkStore } from "../server/store";

test("fork dialog choice binds to the created chat; closed sources reopen and deleted sources keep the summary", async () => {
  const built = await build({ entryPoints: ["client/runtime.ts"], bundle: true, platform: "node", format: "cjs", write: false, plugins: [{ name: "host", setup(builder) {
    builder.onResolve({ filter: /^@getpaseo\/plugin\/client$/ }, () => ({ path: translationModule, external: true }));
    builder.onResolve({ filter: /^react-native$/ }, () => ({ path: "host", namespace: "stub" }));
    builder.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: 'export const Platform = { OS: "web" };' }));
  } }], logLevel: "silent" });
  const module: { exports: any } = { exports: {} };
  new Function("module", "exports", "require", built.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
  const directory = await mkdtemp(join(tmpdir(), "paseo-fork-flow-"));
  const store = new BookmarkStore(join(directory, "bookmarks.json"));
  const target = { sourceAgentId: "agent-a", sourceWorkspaceId: "workspace-a", sourceTitle: "原对话 A", messageId: "message-2", aliases: ["message-2"], seq: 2, epoch: "epoch-a", promptSeq: 1, role: "assistant" as const, summary: "回答 2", timestamp: "2026-11-09T00:00:00.000Z" };
  await store.save("agent-a", target);
  const window = new Window();
  const previousDocument = (globalThis as any).document, previousObserver = (globalThis as any).MutationObserver;
  (globalThis as any).document = window.document; (globalThis as any).MutationObserver = window.MutationObserver;
  let sourceExists = true, openedAgent = "", highlighted = false;
  let sourceSeq = 2, sourceEpoch = "epoch-a", sourceReads = 0;
  const context = (agentId: string) => ({ agentId, serverId: "host-a", workspaceId: "workspace-a" });
  const measurable = (node: any, shown: boolean) => {
    node.getClientRects = () => shown ? [{ width: 500, height: 300 }] : [];
    node.getBoundingClientRect = () => ({ width: shown ? 500 : 0, height: 300, top: 0, bottom: 300 });
  };
  const input = window.document.createElement("div"); input.setAttribute("data-testid", "message-input-root"); measurable(input, true);
  (input as any).__reactFiber$test = { memoizedProps: { serverId: "host-a", workspaceId: "workspace-a", draftId: "draft-b", attachments: [{ kind: "chat_history", source: { agentId: "agent-a" } }] } };
  const scroll = window.document.createElement("div"); scroll.setAttribute("data-testid", "agent-chat-scroll"); measurable(scroll, false);
  const row = window.document.createElement("div"); row.setAttribute("data-history-row-id", "message-2"); row.setAttribute("data-message-id", "message-2");
  measurable(row, true);
  (row as any).__reactProps$test = { children: { props: { item: { kind: "assistant_message", id: "message-2", text: "回答 2", timelineCursor: { epoch: "epoch-a", seq: 2 }, timestamp: new Date(target.timestamp) } } } };
  row.scrollIntoView = () => { highlighted = true; };
  (scroll as any).__reactFiber$test = { memoizedProps: context("agent-a"), child: { memoizedProps: { onJumpToPrompt: () => { scroll.appendChild(row); } } } };
  window.document.body.append(input, scroll);
  const i18n = createTestI18n();
  const client = {
    i18n: i18n.runtime,
    rpc: async (contract: { name: string }, args: any) => {
      switch (contract.name) {
        case "bookmarks.list": return store.list(args.ownerId);
        case "bookmarks.inherit": return store.inherit(args.ownerId, args.sourceAgentId, args.accepted);
        case "bookmarks.bind-draft": return store.bind(args.draftId, args.agentId);
        case "bookmarks.remove": return store.remove(args.ownerId, args.bookmarkId);
        default: throw new Error(`Unexpected RPC: ${contract.name}`);
      }
    },
    openPanel() {},
    paseo: { agents: { ref(agentId: string) { return {
      refresh: async () => agentId === "agent-a" && !sourceExists ? null : { id: agentId, status: "closed" },
      timeline: { refetch: async () => { if (agentId === "agent-a") sourceReads++; return { epoch: agentId === "agent-a" ? sourceEpoch : "epoch-a", error: null, hasOlder: false, entries: agentId === "agent-a" ? [{ item: { type: "assistant_message", text: "回答 2", messageId: "message-2" }, seqStart: sourceSeq }] : [{ item: { type: "user_message", text: "新问题", clientMessageId: `${agentId === "agent-c" ? "draft-c" : "draft-b"}:initial-message` }, seqStart: 1 }] }; } },
    }; } } },
  };
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const runtime = new module.exports.BookmarkRuntime(client);
  const until = async (check: () => boolean) => {
    for (let step = 0; step < 40; step++) { if (check()) return; await new Promise((resolve) => setTimeout(resolve, 30)); }
    assert.fail("state transition did not settle");
  };
  try {
    runtime.attach(cache, "host-a");
    await until(() => runtime.getSnapshot().forkOpen);
    assert.equal(runtime.getSnapshot().fork.sourceAgentId, "agent-a");
    await runtime.chooseInheritance(true);
    assert.equal((await store.list("draft:draft-b")).bookmarks.length, 1);
    (input as any).__reactFiber$test = { memoizedProps: context("agent-b") };
    await until(() => runtime.getSnapshot().active?.agentId === "agent-b");
    await until(() => runtime.getSnapshot().session.bookmarks.length === 1);
    const inherited = runtime.getSnapshot().session.bookmarks[0];
    assert.equal(inherited.sourceAgentId, "agent-a");
    assert.equal((await store.list("agent-b")).bookmarks.length, 1);
    assert.equal((await store.list("draft:draft-b")).bookmarks.length, 0);
    runtime.navigation = { openAgent({ agentId }: { agentId: string }) { openedAgent = agentId; (input as any).__reactFiber$test = { memoizedProps: context(agentId) }; measurable(scroll, true); } };
    await runtime.jump(inherited);
    assert.equal(openedAgent, "agent-a", "a closed source is reopened through Paseo navigation");
    assert.equal(highlighted, true); assert.equal(runtime.getSnapshot().error, null);
    // The UI adapter is the runtime's navigation boundary. A failed first
    // window must re-resolve canonical identity after a rewind, then recover.
    const originalJump = runtime.adapter.jump, attempts: any[] = [];
    runtime.adapter.jump = async (bookmark: any) => {
      attempts.push(bookmark);
      if (attempts.length === 1) { sourceSeq = 12; sourceEpoch = "epoch-after-rewind"; return false; }
      return true;
    };
    openedAgent = ""; const readsBefore = sourceReads;
    await runtime.jump(inherited);
    assert.equal(attempts.length, 2); assert.equal(sourceReads - readsBefore, 2);
    assert.equal(attempts[1].seq, 12); assert.equal(attempts[1].epoch, "epoch-after-rewind");
    assert.equal(openedAgent, "agent-a", "recovery focuses or reopens the source without manual intervention");
    assert.equal(runtime.getSnapshot().error, null);
    runtime.adapter.jump = originalJump; sourceSeq = 2; sourceEpoch = "epoch-a";
    sourceExists = false;
    await runtime.jump(inherited);
    assert.match(runtime.getSnapshot().error, /BOOKMARKS_SOURCE_UNAVAILABLE/);
    assert.equal((await store.list("agent-b")).bookmarks[0].summary, "回答 2");
    await runtime.remove("agent-b", inherited);
    assert.equal((await store.list("agent-b")).bookmarks.length, 0);
    assert.equal((await store.list("agent-a")).bookmarks.length, 1);
    // Dismissing the modal is not a decline. The pending choice must remain
    // reachable after the draft has already become a real conversation.
    measurable(scroll, false);
    (input as any).__reactFiber$test = { memoizedProps: { serverId: "host-a", workspaceId: "workspace-a", draftId: "draft-c", attachments: [{ kind: "chat_history", source: { agentId: "agent-a" } }] } };
    await until(() => runtime.getSnapshot().forkOpen);
    runtime.closeFork();
    (input as any).__reactFiber$test = { memoizedProps: context("agent-c") };
    await until(() => runtime.getSnapshot().fork?.ownerId === "agent-c");
    await runtime.chooseInheritance(true);
    assert.equal((await store.list("agent-c")).bookmarks.length, 1);
    assert.equal((await store.list("draft:draft-c")).bookmarks.length, 0);
  } finally {
    runtime.dispose(); i18n.runtime.dispose(); cache.clear();
    (globalThis as any).document = previousDocument; (globalThis as any).MutationObserver = previousObserver;
    await window.happyDOM.close(); await rm(directory, { recursive: true, force: true });
  }
});
