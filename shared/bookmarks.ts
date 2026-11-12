import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const ownerSchema = z.string().min(1).max(240);
export const bookmarkInputSchema = z.object({
  sourceAgentId: ownerSchema,
  sourceWorkspaceId: ownerSchema,
  sourceTitle: z.string().max(240),
  messageId: z.string().min(1).max(500),
  aliases: z.array(z.string().max(500)).max(8).default([]),
  role: z.enum(["user", "assistant"]),
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("tool"), toolType: z.enum(["command", "tool"]) }),
    z.object({ kind: z.literal("image"), key: z.string().min(1).max(100) }),
  ]).optional(),
  seq: z.number().int().nonnegative(),
  epoch: z.string().max(240),
  promptSeq: z.number().int().nonnegative(),
  summary: z.string().min(1).max(800),
  timestamp: z.string().max(80),
});
export const bookmarkSchema = bookmarkInputSchema.extend({
  id: z.string().min(1).max(800),
  createdAt: z.string(),
  inheritedFrom: ownerSchema.optional(),
});
export const sessionSchema = z.object({
  bookmarks: z.array(bookmarkSchema),
  inheritance: z.object({ sourceAgentId: ownerSchema, accepted: z.boolean() }).optional(),
});
export type BookmarkInput = z.infer<typeof bookmarkInputSchema>;
export type Bookmark = z.infer<typeof bookmarkSchema>;
export type BookmarkSession = z.infer<typeof sessionSchema>;
export const emptySession = (): BookmarkSession => ({ bookmarks: [] });

export const bookmarkErrorKeys = {
  BOOKMARKS_READ_FAILED: "errors.readFailed",
  BOOKMARKS_SELF_INHERITANCE: "errors.selfInheritance",
  BOOKMARKS_OPERATION_FAILED: "errors.operationFailed",
  BOOKMARKS_SAVE_FAILED: "errors.saveFailed",
  BOOKMARKS_SOURCE_UNAVAILABLE: "errors.sourceUnavailable",
  BOOKMARKS_SOURCE_READ_FAILED: "errors.sourceReadFailed",
  BOOKMARKS_SOURCE_READ_INTERRUPTED: "errors.sourceReadInterrupted",
  BOOKMARKS_MESSAGE_UNAVAILABLE: "errors.messageUnavailable",
  BOOKMARKS_MESSAGE_TYPE_CHANGED: "errors.messageTypeChanged",
  BOOKMARKS_OPEN_FROM_PANEL: "errors.openFromPanel",
  BOOKMARKS_LOCATION_PENDING: "errors.locationPending",
} as const;

export const listBookmarks = defineRpc({
  name: "bookmarks.list", input: z.object({ ownerId: ownerSchema }), output: sessionSchema,
});
export const saveBookmark = defineRpc({
  name: "bookmarks.save", input: z.object({ ownerId: ownerSchema, bookmark: bookmarkInputSchema }), output: sessionSchema,
});
export const removeBookmark = defineRpc({
  name: "bookmarks.remove", input: z.object({ ownerId: ownerSchema, bookmarkId: z.string().min(1).max(800) }), output: sessionSchema,
});
export const inheritBookmarks = defineRpc({
  name: "bookmarks.inherit", input: z.object({ ownerId: ownerSchema, sourceAgentId: ownerSchema, accepted: z.boolean() }), output: sessionSchema,
});
export const bindDraft = defineRpc({
  name: "bookmarks.bind-draft", input: z.object({ draftId: ownerSchema, agentId: ownerSchema }), output: sessionSchema,
});

export function bookmarkId(input: Pick<BookmarkInput, "sourceAgentId" | "messageId" | "target">): string {
  const identity = [input.sourceAgentId, input.messageId];
  if (input.target?.kind === "image") identity.push("image", input.target.key);
  else if (input.target?.kind === "tool") identity.push("tool");
  return JSON.stringify(identity);
}

export function sameTarget(left: BookmarkInput, right: BookmarkInput): boolean {
  if (left.sourceAgentId !== right.sourceAgentId || left.target?.kind !== right.target?.kind) return false;
  if (left.target?.kind === "image" && right.target?.kind === "image" && left.target.key !== right.target.key) return false;
  return left.messageId === right.messageId || left.aliases.some(id => right.aliases.includes(id));
}

export function bookmarkLabel(entry: Pick<BookmarkInput, "role" | "target">) {
  return entry.target?.kind === "image" ? "image" : entry.target?.kind === "tool" ? entry.target.toolType === "command" ? "command" : "tool" : entry.role === "user" ? "question" : "answer";
}

export function readableText(text: string): string {
  return text.replace(/^[ \t]{0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})\r?$/gm, " ")
    .replace(/```[^\n]*\n?/g, " ").replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/(^|\n)\s*[#>*]+\s*/g, " ")
    .replace(/[*_`~]/g, "").replace(/\s+/g, " ").trim();
}
export function summarize(text: string): string {
  // Older summaries flattened a leading thematic break into "--- 正文".
  // Repair only that prefix; CLI flags and dashes inside prose stay intact.
  return readableText(text).replace(/^(?:-{3,}\s+)+/, "").slice(0, 800);
}
