import type { PluginClientContext, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import type { QueryClient } from "@tanstack/react-query";
import { bookmarkId, bindDraft, emptySession, inheritBookmarks, listBookmarks, removeBookmark, saveBookmark, summarize, type Bookmark, type BookmarkInput, type BookmarkSession } from "../shared/bookmarks";
import { createWebAdapter, type ChatContext, type ForkSource } from "./web";

type Navigation = PluginWorkspacePanelProps["navigation"];
type Snapshot = {
  active: ChatContext | null;
  session: BookmarkSession;
  loading: boolean;
  error: string | null;
  jumping: string | null;
  fork: ForkSource | null;
  forkOpen: boolean;
  promptChoice: readonly Bookmark[];
};
const key = (ownerId: string) => ["paseo-bookmarks", ownerId] as const;
export class BookmarkRuntime {
  private snapshot: Snapshot = { active: null, session: emptySession(), loading: false, error: null, jumping: null, fork: null, forkOpen: false, promptChoice: [] };
  private listeners = new Set<() => void>();
  private sessions = new Map<string, BookmarkSession>();
  private pending = new Set<string>();
  private forkChecks = new Set<string>();
  private seenAgents = new Set<string>();
  private resolvedDrafts = new Map<string, string>();
  private versions = new Map<string, number>();
  private titles = new Map<string, string>();
  private cache?: QueryClient;
  private adapter?: ReturnType<typeof createWebAdapter>;
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;
  private started = false;
  hostId = "";
  navigation?: Navigation;

  constructor(readonly client: PluginClientContext) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  private patch(update: Partial<Snapshot>) {
    if (this.stopped) return;
    this.snapshot = { ...this.snapshot, ...update };
    for (const listener of this.listeners) listener();
  }
  setTitles(entries: readonly { id: string; title?: string | null }[]) { for (const entry of entries) this.titles.set(entry.id, entry.title || "未命名对话"); }
  title = (agentId: string) => this.titles.get(agentId) ?? "原对话";
  attach(cache: QueryClient, hostId: string) {
    this.cache = cache; this.hostId = hostId;
    if (!this.started && !this.stopped) {
      this.started = true;
      this.adapter = createWebAdapter({
        accepts: (context) => context.serverId === this.hostId,
        context: (context) => { if (context.serverId === this.hostId) this.select(context); },
        fork: (fork) => { if (fork.serverId === this.hostId) void this.detectFork(fork); },
        bookmarks: (context) => context.serverId === this.hostId ? this.sessions.get(context.ownerId)?.bookmarks ?? [] : [],
        toggle: (context, target) => this.toggle(context, target),
        title: this.title,
        prompt: (entries) => { if (entries.length === 1) void this.jump(entries[0]); else this.patch({ promptChoice: entries }); },
        error: (error) => this.patch({ error }),
      });
      this.timer = setInterval(() => { if (this.snapshot.active) void this.load(this.snapshot.active.ownerId).catch(() => undefined); }, 3500);
    }
  }
  setTheme(colors: { accent: string; muted: string; surface: string; border: string }) { this.adapter?.setTheme(colors); }
  select(context: ChatContext) {
    if (this.stopped || context.serverId !== this.hostId) return;
    if (this.snapshot.active?.ownerId === context.ownerId && this.snapshot.active.workspaceId === context.workspaceId) return;
    this.patch({ active: context, session: this.sessions.get(context.ownerId) ?? emptySession(), error: null, loading: true });
    void this.load(context.ownerId).catch((error) => this.fail(error));
    if (context.agentId && !this.seenAgents.has(context.agentId)) {
      this.seenAgents.add(context.agentId);
      void this.bindInitialDraft(context.agentId).catch(() => { this.seenAgents.delete(context.agentId!); });
    }
  }
  private publish(ownerId: string, session: BookmarkSession) {
    this.sessions.set(ownerId, session); this.cache?.setQueryData(key(ownerId), session);
    if (this.snapshot.active?.ownerId === ownerId) this.patch({ session, loading: false });
    this.adapter?.refresh();
  }
  private commit(ownerId: string, session: BookmarkSession) {
    this.versions.set(ownerId, (this.versions.get(ownerId) ?? 0) + 1);
    this.publish(ownerId, session);
  }
  async load(ownerId: string) {
    if (this.stopped) return;
    const version = this.versions.get(ownerId) ?? 0;
    const read = () => this.client.rpc(listBookmarks, { ownerId });
    const session = this.cache ? await this.cache.fetchQuery({ queryKey: key(ownerId), queryFn: read, staleTime: 1000 }) : await read();
    if ((this.versions.get(ownerId) ?? 0) !== version) return this.sessions.get(ownerId);
    if (!this.stopped) this.publish(ownerId, session);
    return session;
  }
  private fail(error: unknown) { this.patch({ loading: false, error: error instanceof Error ? error.message : "操作失败，请重试。" }); }
  async toggle(context: ChatContext, target: BookmarkInput) {
    if (context.serverId !== this.hostId || context.agentId !== target.sourceAgentId) return;
    const pendingKey = `${context.ownerId}:${bookmarkId(target)}`;
    if (this.pending.has(pendingKey)) return;
    this.pending.add(pendingKey);
    try {
      const session = await this.load(context.ownerId);
      const existing = session?.bookmarks.find((entry) => entry.sourceAgentId === target.sourceAgentId && (entry.messageId === target.messageId || entry.aliases.some((id) => target.aliases.includes(id))));
      const next = existing ? await this.client.rpc(removeBookmark, { ownerId: context.ownerId, bookmarkId: existing.id }) : await this.client.rpc(saveBookmark, { ownerId: context.ownerId, bookmark: target });
      this.commit(context.ownerId, next);
      if (!existing) this.openPanel(context.workspaceId);
    } catch (error) { this.fail(error); throw error; }
    finally { this.pending.delete(pendingKey); }
  }
  async remove(ownerId: string, bookmark: Bookmark) {
    try { this.commit(ownerId, await this.client.rpc(removeBookmark, { ownerId, bookmarkId: bookmark.id })); }
    catch (error) { this.fail(error); throw error; }
  }
  private async detectFork(fork: ForkSource) {
    if (this.forkChecks.has(fork.ownerId)) return;
    this.forkChecks.add(fork.ownerId);
    try {
      const session = await this.load(fork.ownerId);
      if (this.stopped || session?.inheritance) return;
      // Modal entry is tied to the visible draft, not a newly created unrelated agent.
      if (this.snapshot.active?.ownerId !== fork.ownerId) { this.forkChecks.delete(fork.ownerId); return; }
      this.patch({ fork, forkOpen: true }); this.openPanel(fork.workspaceId);
    } catch (error) { this.forkChecks.delete(fork.ownerId); this.fail(error); }
  }
  closeFork() { this.patch({ forkOpen: false }); }
  reopenFork() { this.patch({ forkOpen: true }); }
  closePrompt() { this.patch({ promptChoice: [] }); }
  clearError() { this.patch({ error: null }); }
  async chooseInheritance(accepted: boolean) {
    const fork = this.snapshot.fork;
    if (!fork) return;
    try {
      const session = await this.client.rpc(inheritBookmarks, { ownerId: fork.ownerId, sourceAgentId: fork.sourceAgentId, accepted });
      this.commit(fork.ownerId, session);
      const resolved = this.resolvedDrafts.get(fork.draftId);
      if (resolved) this.commit(resolved, await this.client.rpc(bindDraft, { draftId: fork.draftId, agentId: resolved }));
      this.patch({ fork: null, forkOpen: false });
    } catch (error) { this.fail(error); throw error; }
  }
  private async bindInitialDraft(agentId: string) {
    const handle = this.client.paseo.agents.ref(agentId);
    let page = await handle.timeline.refetch({ direction: "tail", limit: 30 });
    if (page.error) throw new Error(page.error);
    if (page.hasOlder) page = await handle.timeline.refetch({ direction: "after", cursor: { epoch: page.epoch, seq: 0 }, limit: 10 });
    const initial = page.entries.find(({ item }) => item.type === "user_message" && item.clientMessageId?.endsWith(":initial-message"));
    if (initial?.item.type !== "user_message" || !initial.item.clientMessageId) return;
    const draftId = initial.item.clientMessageId.slice(0, -":initial-message".length);
    this.resolvedDrafts.set(draftId, agentId);
    if (this.snapshot.fork?.draftId === draftId) this.patch({ fork: { ...this.snapshot.fork, ownerId: agentId, agentId } });
    const session = await this.client.rpc(bindDraft, { draftId, agentId });
    if (!this.stopped) this.commit(agentId, session);
  }
  openPanel(workspaceId: string) { this.client.openPanel("bookmarks", { workspaceId, location: "explorer" }); }
  private async resolveTarget(bookmark: Bookmark): Promise<Bookmark> {
    const handle = this.client.paseo.agents.ref(bookmark.sourceAgentId);
    const source = await handle.refresh();
    if (!source) throw new Error("原对话已删除或不可访问，无法跳转。书签摘要仍然保留。");
    let page = await handle.timeline.refetch({ direction: "tail", limit: 100 });
    if (page.error) throw new Error("暂时无法读取原对话，请检查主机连接后重试。");
    const matches = (entry: typeof page.entries[number]) => {
      const item = entry.item;
      if (item.type !== (bookmark.role === "user" ? "user_message" : "assistant_message")) return false;
      const ids = [item.messageId, item.type === "user_message" ? item.clientMessageId : undefined].filter(Boolean);
      return ids.some((id) => id === bookmark.messageId || bookmark.aliases.includes(id!)) || (page.epoch === bookmark.epoch && entry.seqStart === bookmark.seq && summarize(item.text).startsWith(bookmark.summary.slice(0, 100)));
    };
    let target = page.entries.find(matches);
    if (!target && page.epoch === bookmark.epoch) {
      page = await handle.timeline.refetch({ direction: "after", cursor: { epoch: page.epoch, seq: Math.max(0, bookmark.seq - 1) }, limit: 5 });
      if (page.error) throw new Error("原对话读取中断，请稍后重试。");
      target = page.entries.find(matches);
    }
    // Rewinds/replacements invalidate old seqs. Resolve stable message identity,
    // and never jump to a different message that reused an old seq.
    for (let count = 0; !target && page.hasOlder && page.startCursor && count < 80; count++) {
      page = await handle.timeline.refetch({ direction: "before", cursor: page.startCursor, limit: 100 });
      if (page.error) throw new Error("原对话读取中断，请稍后重试。");
      target = page.entries.find(matches);
    }
    if (!target) throw new Error("原消息已移除或当前无法定位，书签摘要仍然保留。");
    const item = target.item;
    if (item.type !== "user_message" && item.type !== "assistant_message") throw new Error("原消息类型已变化，无法定位。");
    const ids = [item.messageId, item.type === "user_message" ? item.clientMessageId : undefined, bookmark.messageId, ...bookmark.aliases].filter((id): id is string => Boolean(id));
    return { ...bookmark, messageId: item.messageId ?? bookmark.messageId, aliases: [...new Set(ids)].slice(0, 8), seq: target.seqStart, epoch: page.epoch };
  }
  async jump(bookmark: Bookmark, navigation = this.navigation) {
    if (this.snapshot.jumping || this.stopped) return;
    this.patch({ jumping: bookmark.id, error: null, promptChoice: [] });
    try {
      // A rewind or slow tab activation can invalidate the first target window.
      // Recover once with fresh canonical identity and native tab navigation.
      for (let attempt = 0; attempt < 2 && !this.stopped; attempt++) {
        const target = await this.resolveTarget(bookmark);
        if (this.stopped) return;
        if (this.snapshot.active?.agentId !== bookmark.sourceAgentId || attempt > 0) {
          if (navigation) navigation.openAgent({ agentId: bookmark.sourceAgentId, serverId: this.hostId });
          else if (this.snapshot.active?.agentId !== bookmark.sourceAgentId) throw new Error("请从右侧书签面板点击，打开原对话。");
        }
        if (await this.adapter?.jump(target)) return;
      }
      if (!this.stopped) throw new Error("原消息仍在历史中，但页面尚未完成定位。已自动重试，请稍后再次点击书签。");
    } catch (error) { this.fail(error); }
    finally { this.patch({ jumping: null }); }
  }
  dispose() { this.stopped = true; if (this.timer) clearInterval(this.timer); this.adapter?.dispose(); this.listeners.clear(); }
}
