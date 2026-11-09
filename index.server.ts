import type { PluginServerContext } from "@getpaseo/plugin/server";
import { listBookmarks, saveBookmark, removeBookmark, inheritBookmarks, bindDraft } from "./shared/bookmarks";
import { BookmarkStore } from "./server/store";

export default function contribute(server: PluginServerContext) {
  const store = new BookmarkStore();
  server.handle(listBookmarks, ({ ownerId }) => store.list(ownerId));
  server.handle(saveBookmark, ({ ownerId, bookmark }) => store.save(ownerId, bookmark));
  server.handle(removeBookmark, ({ ownerId, bookmarkId }) => store.remove(ownerId, bookmarkId));
  server.handle(inheritBookmarks, ({ ownerId, sourceAgentId, accepted }) => store.inherit(ownerId, sourceAgentId, accepted));
  server.handle(bindDraft, ({ draftId, agentId }) => store.bind(draftId, agentId));
  return () => {};
}
