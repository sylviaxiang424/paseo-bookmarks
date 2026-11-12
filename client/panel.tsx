import { useEffect, useState, useSyncExternalStore } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import type { PluginButtonIconProps, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useAgent, useTranslation } from "@getpaseo/plugin/client";
import { Icon, Modal, ScrollView } from "@getpaseo/plugin/client/ui";
import { Platform, Pressable, Text, View } from "react-native";
import { messages, localizeError } from "./messages";
import { bookmarkLabel, type Bookmark } from "../shared/bookmarks";
import type { BookmarkRuntime } from "./runtime";

export function BookmarkBridge({ runtime, ...props }: PluginButtonIconProps & { runtime: BookmarkRuntime }) {
  const { locale, t } = useTranslation(messages);
  const cache = useQueryClient();
  const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
  useEffect(() => { runtime.refreshLanguage(); }, [runtime, locale]);
  const [saving, setSaving] = useState(false);
  useEffect(() => { runtime.attach(cache, props.host.id); }, [runtime, cache, props.host.id]);
  useEffect(() => {
    runtime.setTheme({ accent: props.theme.colors.statusWarning, muted: props.theme.colors.foregroundMuted, surface: props.theme.colors.surface0, border: props.theme.colors.border });
  }, [runtime, props.theme]);
  const colors = props.theme.colors;
  const isWorkspace = props.context === "workspace";
  const fork = state.fork?.workspaceId === props.workspaceId ? state.fork : null;
  const choose = async (accepted: boolean) => {
    setSaving(true);
    try { await runtime.chooseInheritance(accepted); } catch {} finally { setSaving(false); }
  };
  return <>
    <Icon name="Bookmark" size={props.size} color={props.color} />
    {isWorkspace ? <>
      <Modal title={t("forkTitle")} icon={<Icon name="GitFork" size={18} color={colors.foreground} />} open={Boolean(fork && state.forkOpen)} onOpenChange={(open) => { if (!open) runtime.closeFork(); }}>
        <Modal.Content>
          <Text style={{ color: colors.foreground, fontSize: 14, lineHeight: 22 }}>{t("forkQuestion", { title: fork ? runtime.title(fork.sourceAgentId) : t("sourceConversation") })}</Text>
          <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 19, marginTop: 12 }}>{t("forkExplanation")}</Text>
          {state.error ? <Text style={{ color: colors.statusDanger, marginTop: 12 }}>{localizeError(state.error, t)}</Text> : null}
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
            <Pressable accessibilityRole="button" accessibilityLabel={t("declineLabel")} disabled={saving} onPress={() => void choose(false)} style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 7, backgroundColor: colors.surface2 }}>
              <Text style={{ color: colors.foreground, fontSize: 13 }}>{t("decline")}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={t("inherit")} disabled={saving} onPress={() => void choose(true)} style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 7, backgroundColor: colors.accent, opacity: saving ? 0.6 : 1 }}>
              <Text style={{ color: colors.accentForeground, fontSize: 13, fontWeight: "600" }}>{saving ? t("saving") : t("inherit")}</Text>
            </Pressable>
          </View>
        </Modal.Content>
      </Modal>
      <Modal title={t("turnBookmarks")} icon={<Icon name="Bookmark" size={18} color={colors.foreground} />} open={state.promptChoice.length > 0 && state.active?.workspaceId === props.workspaceId} onOpenChange={(open) => { if (!open) runtime.closePrompt(); }}>
        <Modal.Content>
          {state.promptChoice.map((bookmark) => <Pressable key={bookmark.id} accessibilityRole="button" onPress={() => void runtime.jump(bookmark)} style={{ padding: 12, marginBottom: 8, borderRadius: 7, backgroundColor: colors.surface1 }}>
            <Text style={{ color: colors.foregroundMuted, fontSize: 11, marginBottom: 5 }}>{t(bookmarkLabel(bookmark))}</Text>
            <Text numberOfLines={3} style={{ color: colors.foreground, fontSize: 13, lineHeight: 20 }}>{bookmark.summary}</Text>
          </Pressable>)}
        </Modal.Content>
      </Modal>
    </> : null}
  </>;
}

export function BookmarkPanel({ runtime, ...props }: PluginWorkspacePanelProps & { runtime: BookmarkRuntime }) {
  const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
  const { t } = useTranslation(messages);
  const cache = useQueryClient();
  const colors = props.theme.colors;
  const active = state.active?.workspaceId === props.workspaceId ? state.active : null;
  const title = useAgent(active?.agentId ?? "", (agent) => agent.title);
  const removal = useMutation({ mutationFn: ({ ownerId, bookmark }: { ownerId: string; bookmark: Bookmark }) => runtime.remove(ownerId, bookmark) });
  useEffect(() => { runtime.attach(cache, props.host.id); runtime.navigation = props.navigation; }, [runtime, cache, props.host.id, props.navigation]);
  const session = active ? state.session : { bookmarks: [] };
  const count = session.bookmarks.length;
  const currentFork = active?.ownerId === state.fork?.ownerId ? state.fork : null;
  return <View style={{ flex: 1, minHeight: 0, backgroundColor: colors.surface0 }}>
    <View style={{ paddingHorizontal: 16, paddingTop: 18, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Icon name="Bookmark" size={17} color={colors.statusWarning} />
        <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "600", flex: 1 }}>{t("title")}</Text>
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{count}</Text>
      </View>
      <Text numberOfLines={2} style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18, marginTop: 9 }}>{!active ? t("selectConversation") : active.draftId ? t("newFork") : title || runtime.title(active.agentId!)}</Text>
    </View>
    {state.error ? <View accessibilityRole="alert" style={{ padding: 12, margin: 12, borderRadius: 7, backgroundColor: colors.surface1 }}>
      <Text style={{ color: colors.statusDanger, fontSize: 12, lineHeight: 19 }}>{localizeError(state.error, t)}</Text>
      <Pressable accessibilityRole="button" onPress={() => runtime.clearError()} style={{ alignSelf: "flex-end", paddingTop: 8 }}><Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{t("dismissError")}</Text></Pressable>
    </View> : null}
    {currentFork ? <View style={{ padding: 13, margin: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 8 }}>
      <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 20 }}>{t("pendingFork")}</Text>
      <Pressable accessibilityRole="button" onPress={() => runtime.reopenFork()} style={{ paddingTop: 9 }}><Text style={{ color: colors.accent, fontSize: 12 }}>{t("chooseInheritance")}</Text></Pressable>
    </View> : null}
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 9, paddingBottom: 20 }}>
      {!count ? <View style={{ alignItems: "center", paddingVertical: 40, paddingHorizontal: 12, gap: 12 }}>
        <Icon name="Bookmark" size={28} color={colors.foregroundMuted} />
        <Text style={{ color: colors.foreground, fontSize: 14 }}>{!active ? t("selectConversation") : state.loading ? t("loading") : t("empty")}</Text>
        {active ? <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 20, textAlign: "center" }}>{t(Platform.OS === "web" ? "emptyHint" : "desktopOnly")}</Text> : null}
      </View> : session.bookmarks.map((bookmark, index) => {
        const inherited = bookmark.sourceAgentId !== active?.agentId;
        const removing = removal.isPending && removal.variables?.bookmark.id === bookmark.id;
        return <View key={bookmark.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 9, overflow: "hidden", backgroundColor: colors.surface1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: 12, paddingRight: 6, paddingTop: 7 }}>
            <Icon name={bookmark.target?.kind === "image" ? "Image" : bookmark.target?.kind === "tool" ? bookmark.target.toolType === "command" ? "Terminal" : "Wrench" : bookmark.role === "user" ? "MessageCircle" : "Sparkles"} size={12} color={colors.foregroundMuted} />
            <Text style={{ color: colors.foregroundMuted, fontSize: 11, marginLeft: 6, flex: 1 }}>{t(bookmarkLabel(bookmark))} · {String(index + 1).padStart(2, "0")}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t("removeLabel", { summary: bookmark.summary.slice(0, 40) })} disabled={removing} onPress={() => { if (active) removal.mutate({ ownerId: active.ownerId, bookmark }); }} style={{ padding: 7, borderRadius: 5, opacity: removing ? 0.4 : 1 }}>
              <Icon name="Trash2" size={13} color={colors.foregroundMuted} />
            </Pressable>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t(inherited ? "jumpSourceLabel" : "jumpLabel", { summary: bookmark.summary.slice(0, 80) })} disabled={Boolean(state.jumping)} onPress={() => void runtime.jump(bookmark, props.navigation)} style={({ pressed }) => ({ paddingHorizontal: 12, paddingTop: 4, paddingBottom: 12, opacity: pressed ? 0.65 : 1 })}>
            <Text numberOfLines={4} style={{ color: colors.foreground, fontSize: 13, lineHeight: 20 }}>{bookmark.summary}</Text>
            {inherited ? <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 9 }}>
              <Icon name="GitFork" size={11} color={colors.foregroundMuted} />
              <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 11, flex: 1 }}>{t("from", { title: bookmark.sourceTitle || t("sourceConversation") })}</Text>
              <Icon name="ArrowUpRight" size={11} color={colors.foregroundMuted} />
            </View> : null}
            {state.jumping === bookmark.id ? <Text style={{ color: colors.foregroundMuted, fontSize: 11, marginTop: 8 }}>{t("jumping")}</Text> : null}
          </Pressable>
        </View>;
      })}
    </ScrollView>
    <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: colors.border }}>
      <Text style={{ color: colors.foregroundMuted, fontSize: 10, lineHeight: 16 }}>{t("footer")}</Text>
    </View>
  </View>;
}
