import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { Window } from "happy-dom";
import { QueryClient } from "@tanstack/react-query";
import { BookmarkStore } from "../server/store";
import { createTestI18n, translationModule } from "./host-translations";

const compiled = build({ entryPoints: ["client/runtime.ts"], bundle: true, platform: "node", format: "cjs", write: false,
  plugins: [{ name: "host", setup(builder) {
    builder.onResolve({ filter: /^@getpaseo\/plugin\/client$/ }, () => ({ path: translationModule, external: true }));
    builder.onResolve({ filter: /^react-native$/ }, () => ({ path: "host", namespace: "stub" }));
    builder.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: 'export const Platform = { OS: "web" };' }));
  } }], logLevel: "silent" }).then(built => {
  const module = { exports: {} as any };
  new Function("module", "exports", "require", built.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
  return module.exports;
});

const cases = [
  { name: "an empty source skips the fork prompt and does not open the panel", mode: "empty", prompt: false },
  { name: "removing the last source bookmark skips the prompt despite a populated cache", mode: "removed", prompt: false },
  { name: "adding a source bookmark prompts despite an empty cache", mode: "added", prompt: true },
  { name: "a source containing only inherited bookmarks still offers inheritance", mode: "inherited", prompt: true },
  { name: "leaving the draft during the source lookup never opens a late prompt", mode: "leave", prompt: false },
];

for (const scenario of cases) test(scenario.name, async () => {
  const { BookmarkRuntime } = await compiled;
  const directory = await mkdtemp(join(tmpdir(), "paseo-fork-prompt-"));
  const store = new BookmarkStore(join(directory, "bookmarks.json"));
  const window = new Window(), i18n = createTestI18n();
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const previous = { document: (globalThis as any).document, MutationObserver: (globalThis as any).MutationObserver };
  const input = window.document.createElement("div");
  input.dataset.testid = "message-input-root";
  input.getClientRects = () => [{ width: 500, height: 300 }] as any;
  input.getBoundingClientRect = () => ({ left: 0, right: 500, top: 0, bottom: 300, width: 500, height: 300 }) as any;
  (input as any).__reactFiber$test = { memoizedProps: { serverId: "host", workspaceId: "workspace", draftId: "new-fork",
    attachments: [{ kind: "chat_history", source: { agentId: "source" } }] } };
  window.document.body.append(input);
  const opened: string[] = [];
  let lookupStarted!: () => void, releaseLookup!: () => void;
  const started = new Promise<void>(resolve => { lookupStarted = resolve; });
  const gate = new Promise<void>(resolve => { releaseLookup = resolve; });
  const runtime = new BookmarkRuntime({ i18n: i18n.runtime,
    openPanel(_id: string, options: { workspaceId: string }) { opened.push(options.workspaceId); },
    async rpc(contract: { name: string }, args: { ownerId: string }) {
      assert.equal(contract.name, "bookmarks.list");
      if (args.ownerId === "source") {
        lookupStarted();
        if (scenario.mode === "leave") await gate;
      }
      return store.list(args.ownerId);
    },
  });
  // Await the actual DOM adapter callback, including its asynchronous reads.
  let detection: Promise<void> | undefined;
  const detect = runtime.detectFork.bind(runtime);
  runtime.detectFork = (fork: any) => { const result = detect(fork); detection ??= result; return result; };
  try {
    const target = { sourceAgentId: "source", sourceWorkspaceId: "workspace", sourceTitle: "Source", messageId: "answer", aliases: ["answer"],
      role: "assistant" as const, seq: 2, epoch: "epoch", promptSeq: 1, summary: "Saved answer", timestamp: "2026-11-12T00:00:00Z" };
    if (scenario.mode !== "empty") await store.save("source", target);
    if (scenario.mode === "removed") {
      const saved = await store.list("source");
      cache.setQueryData(["paseo-bookmarks", "source"], saved);
      await store.remove("source", saved.bookmarks[0].id);
    } else if (scenario.mode === "added") cache.setQueryData(["paseo-bookmarks", "source"], { bookmarks: [] });
    else if (scenario.mode === "inherited") {
      await store.inherit("inherited-source", "source", true);
      (input as any).__reactFiber$test.memoizedProps.attachments[0].source.agentId = "inherited-source";
    }
    Object.assign(globalThis, { document: window.document, MutationObserver: window.MutationObserver });
    runtime.attach(cache, "host");
    assert.ok(detection, "the visible fork draft triggers detection");
    if (scenario.mode === "leave") {
      await started;
      input.remove(); runtime.adapter.syncContext(); releaseLookup();
    }
    await detection;
    assert.equal(runtime.getSnapshot().forkOpen, scenario.prompt);
    assert.equal(Boolean(runtime.getSnapshot().fork), scenario.prompt, "a skipped prompt leaves no pending inheritance banner");
    assert.deepEqual(opened, scenario.prompt ? ["workspace"] : []);
    assert.equal(runtime.getSnapshot().error, null);
    assert.deepEqual((await store.list("draft:new-fork")).bookmarks, [], "checking never copies bookmarks without a choice");
  } finally {
    releaseLookup(); runtime.dispose(); cache.clear(); i18n.runtime.dispose();
    Object.assign(globalThis, previous); await window.happyDOM.close();
    await rm(directory, { recursive: true, force: true });
  }
});
