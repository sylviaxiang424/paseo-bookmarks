import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BookmarkStore } from "../server/store";
import { bookmarkId, summarize, type BookmarkInput } from "../shared/bookmarks";

const target = (seq = 1): BookmarkInput => ({ sourceAgentId: "agent-a", sourceWorkspaceId: "workspace-a", sourceTitle: "原对话", messageId: `message-${seq}`, aliases: [`message-${seq}`], seq, epoch: "epoch-a", promptSeq: 1, role: "assistant", summary: `回答 ${seq}`, timestamp: `2026-11-09T01:00:${String(seq).padStart(2, "0")}Z` });
async function fixture(run: (store: BookmarkStore, file: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "paseo-bookmarks-test-"));
  try { const file = join(directory, "bookmarks.json"); await run(new BookmarkStore(file), file); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test("bookmarks survive a fresh store, stay isolated by chat, and update without duplicates", () => fixture(async (store, file) => {
  await store.save("agent-a", target());
  await store.save("agent-a", { ...target(), summary: "更新的摘要" });
  const restored = new BookmarkStore(file);
  assert.equal((await restored.list("agent-a")).bookmarks.length, 1);
  assert.equal((await restored.list("agent-a")).bookmarks[0].summary, "更新的摘要");
  assert.deepEqual((await restored.list("agent-b")).bookmarks, []);
  await restored.remove("agent-a", bookmarkId(target()));
  assert.deepEqual((await new BookmarkStore(file).list("agent-a")).bookmarks, []);
}));

test("concurrent additions and removals do not lose another bookmark", () => fixture(async (store) => {
  await Promise.all(Array.from({ length: 30 }, (_, index) => store.save("agent-a", target(index + 1))));
  assert.equal((await store.list("agent-a")).bookmarks.length, 30);
  await Promise.all(Array.from({ length: 15 }, (_, index) => store.remove("agent-a", bookmarkId(target(index + 1)))));
  assert.equal((await store.list("agent-a")).bookmarks.length, 15);
}));

test("a fork keeps source references and its own removal does not remove the original", () => fixture(async (store, file) => {
  await store.save("agent-a", target());
  const inherited = await store.inherit("agent-b", "agent-a", true);
  assert.equal(inherited.bookmarks[0].sourceAgentId, "agent-a");
  assert.equal(inherited.bookmarks[0].messageId, "message-1");
  assert.equal(inherited.bookmarks[0].inheritedFrom, "agent-a");
  assert.equal((await new BookmarkStore(file).list("agent-b")).inheritance?.accepted, true);
  await store.remove("agent-b", inherited.bookmarks[0].id);
  assert.equal((await store.list("agent-b")).bookmarks.length, 0);
  assert.equal((await store.list("agent-a")).bookmarks.length, 1);
  // Reentering the fork must respect the explicit removal.
  await store.inherit("agent-b", "agent-a", true);
  assert.equal((await store.list("agent-b")).bookmarks.length, 0);
}));

test("declining inheritance is remembered, and a draft transfers to the exact created chat once", () => fixture(async (store) => {
  await store.save("agent-a", target());
  await store.inherit("draft:declined", "agent-a", false);
  await store.bind("declined", "agent-b");
  assert.equal((await store.list("agent-b")).inheritance?.accepted, false);
  assert.equal((await store.list("agent-b")).bookmarks.length, 0);
  await store.inherit("draft:accepted", "agent-a", true);
  await store.bind("accepted", "agent-c");
  await store.bind("accepted", "agent-c");
  assert.equal((await store.list("agent-c")).bookmarks.length, 1);
  assert.equal((await store.list("draft:accepted")).bookmarks.length, 0);
  assert.equal((await store.list("agent-b")).bookmarks.length, 0);
}));

test("inherited snapshots remain readable when their source list is emptied", () => fixture(async (store) => {
  await store.save("agent-a", target());
  await store.inherit("agent-b", "agent-a", true);
  await store.remove("agent-a", bookmarkId(target()));
  assert.equal((await store.list("agent-b")).bookmarks[0].summary, "回答 1");
}));

test("a corrupt file is preserved instead of silently replaced", () => fixture(async (store, file) => {
  await writeFile(file, "{broken", "utf8");
  await assert.rejects(store.save("agent-a", target()), /BOOKMARKS_READ_FAILED/);
  assert.equal(await readFile(file, "utf8"), "{broken");
}));

test("summary uses readable text and bounds stored content", () => {
  assert.equal(summarize("## 方案\n\n**跳转**到[原文](https://example.com)。"), "方案 跳转到原文。");
  assert.equal(summarize("长".repeat(1000)).length, 800);
  assert.equal(summarize("---\n\n确认了：正文。\n\n- - -\n下一段。"), "确认了：正文。 下一段。");
  assert.equal(summarize("***\n**正文**\n___"), "正文");
  assert.equal(summarize("命令 --help，foo--bar 和 a-b。"), "命令 --help，foo--bar 和 a-b。");
});

test("existing flattened rule prefixes are cleaned while source identity and flags remain intact", () => fixture(async (store, file) => {
  await store.save("agent-a", { ...target(), summary: "--- 确认了：使用 --help。" });
  const restored = await new BookmarkStore(file).list("agent-a");
  assert.equal(restored.bookmarks[0].summary, "确认了：使用 --help。");
  assert.equal(restored.bookmarks[0].id, bookmarkId(target()));
  assert.equal(restored.bookmarks[0].sourceAgentId, "agent-a");
}));
