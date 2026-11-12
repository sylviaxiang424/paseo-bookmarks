import assert from "node:assert/strict";
import { test } from "node:test";
import { imageKey, markdownImages, toolSummary } from "../shared/outputs";
import { sameTarget, bookmarkId, type BookmarkInput } from "../shared/bookmarks";

const base: BookmarkInput = { sourceAgentId: "a", sourceWorkspaceId: "w", sourceTitle: "", messageId: "parent", aliases: ["parent", "row"], role: "assistant", seq: 2, epoch: "e", promptSeq: 1, summary: "text", timestamp: "2026-11-10" };

test("image identities exclude code examples and distinguish repeated images, reference links and balanced URLs", () => {
  const text = '```md\n![fake](fake.png)\n```\n`![inline](fake.png)`\n![First](https://a.test/image_(1).png)\n![Again](https://a.test/image_(1).png)\n![Reference][ref]\n[ref]: <https://a.test/two.png>\n';
  const images = markdownImages(text);
  assert.equal(images.length, 3);
  assert.equal(images[0].source, "https://a.test/image_(1).png");
  assert.equal(images[0].key, imageKey(images[0].source, 0));
  assert.equal(images[1].key, imageKey(images[0].source, 1));
  assert.equal(images[2].source, "https://a.test/two.png");
  assert.deepEqual(markdownImages("![unfinished]("), []);
});

test("sibling pictures and the parent answer toggle independently even with identical row aliases", () => {
  const first = { ...base, target: { kind: "image", key: "first:0" } as const };
  const second = { ...base, target: { kind: "image", key: "second:0" } as const };
  assert.equal(sameTarget(base, first), false);
  assert.equal(sameTarget(first, second), false);
  assert.equal(sameTarget(first, { ...first, messageId: "row" }), true);
  assert.equal(new Set([base, first, second].map(bookmarkId)).size, 3);
  assert.equal(bookmarkId(base), '["a","parent"]', "old bookmark IDs are unchanged");
});

test("tool summaries preserve command punctuation and include execution or structured results", () => {
  assert.equal(toolSummary("shell", { type: "shell", command: "printf RESULT_ONE --help", output: "RESULT_ONE\n" }), "printf RESULT_ONE --help RESULT_ONE");
  assert.equal(toolSummary("apply_patch", { type: "edit", filePath: "out.txt", newString: "SAVED_RESULT" }), "out.txt SAVED_RESULT");
  assert.equal(toolSummary("lookup", { type: "unknown", output: { count: 2 } }), 'lookup {"count":2}');
  assert.equal(toolSummary("tool", { type: "read", content: "x".repeat(2000) }).length, 800);
});
