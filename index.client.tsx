import type { PluginClientContext, PluginButtonIconProps, PluginButtonRegistration } from "@getpaseo/plugin/client";
import { BookmarkRuntime } from "./client/runtime";
import { BookmarkBridge, BookmarkPanel } from "./client/panel";

export default function contribute(client: PluginClientContext) {
  const runtime = new BookmarkRuntime(client);
  const lifetime = new AbortController();
  const pills = new Map<string, PluginButtonRegistration>();
  const headers = new Map<string, PluginButtonRegistration>();
  const Icon = (props: PluginButtonIconProps) => <BookmarkBridge {...props} runtime={runtime} />;
  const stopPanel = client.addWorkspacePanel({ id: "bookmarks", title: "书签", icon: "Bookmark", locations: ["explorer"], Component: (props) => <BookmarkPanel {...props} runtime={runtime} /> });
  const stopCommand = client.addCommandCenterItem({ id: "open-bookmarks", title: "打开对话书签", icon: "Bookmark", context: "workspace", keywords: ["bookmark", "书签", "收藏"], onSelect({ workspace }) { runtime.openPanel(workspace.id); } });
  const register = (agent: { id: string; workspaceId?: string | null; title?: string | null }) => {
    if (lifetime.signal.aborted || !agent.workspaceId) return;
    runtime.setTitles([agent]);
    const workspaceId = agent.workspaceId, agentId = agent.id;
    if (!headers.has(workspaceId)) headers.set(workspaceId, client.addHeaderButton({ id: "bookmarks", workspaceId, button: { title: "打开对话书签", label: "书签", icon: Icon, behavior: { kind: "action", onPress: () => runtime.openPanel(workspaceId) } } }));
    if (!pills.has(agentId)) pills.set(agentId, client.addComposerPill({ id: "bookmarks", workspaceId, agentId, button: { title: "打开对话书签", label: "书签", icon: Icon, behavior: { kind: "action", onPress: () => { runtime.select({ serverId: runtime.hostId, workspaceId, agentId, ownerId: agentId }); runtime.openPanel(workspaceId); } } } }));
  };
  void client.paseo.agents.list({ subscribe: {}, signal: lifetime.signal }).then(({ subscription }) => {
    if (lifetime.signal.aborted) { void subscription.release(); return; }
    let generation = 0;
    subscription.subscribe({
      snapshot: (first) => {
        const run = ++generation;
        for (const { agent } of first.entries) register(agent);
        void (async () => {
          let page: { entries: typeof first.entries; pageInfo: typeof first.pageInfo } = first;
          while (page.pageInfo.hasMore && page.pageInfo.nextCursor && !lifetime.signal.aborted && run === generation) {
            page = await client.paseo.agents.list({ page: { cursor: page.pageInfo.nextCursor, limit: 100 }, signal: lifetime.signal });
            if (!lifetime.signal.aborted && run === generation) for (const { agent } of page.entries) register(agent);
          }
        })().catch(() => undefined);
      },
      update: (message) => {
        if (message.type !== "agent_update") return;
        if (message.payload.kind === "upsert") register(message.payload.agent);
        else { pills.get(message.payload.agentId)?.remove(); pills.delete(message.payload.agentId); }
      },
    });
  }).catch((error) => { if (!lifetime.signal.aborted) console.error("Bookmark directory observation failed", error); });
  return () => {
    lifetime.abort(); runtime.dispose(); stopPanel(); stopCommand();
    for (const pill of pills.values()) pill.remove();
    for (const header of headers.values()) header.remove();
  };
}
