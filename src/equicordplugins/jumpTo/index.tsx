/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Devs } from "@utils/constants";
import definePlugin, { IconComponent } from "@utils/types";
import { Channel, Message, User } from "@vencord/discord-types";
import { ChannelStore, Constants, Menu, NavigationRouter, RestAPI, SelectedChannelStore, SelectedGuildStore, showToast } from "@webpack/common";

const JumpToFirstIcon: IconComponent = ({ height = 20, width = 20, className }) => {
    return (
        <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            width={width}
            height={height}
            className={className}
        >
            <g transform="scale(0.833333)">
                <path d="M5 3h14" />
                <path d="m18 13-6-6-6 6" />
                <path d="M12 7v14" />
            </g>
        </svg>
    );
};

const JumpToLastIcon: IconComponent = ({ height = 20, width = 20, className }) => {
    return (
        <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            width={width}
            height={height}
            className={className}
        >
            <g transform="scale(0.833333)">
                <path d="M12 17V3" />
                <path d="m6 11 6 6 6-6" />
                <path d="M19 21H5" />
            </g>
        </svg>
    );
};

function jumpToFirstMessage(channelId: string, guildId?: string | null) {
    NavigationRouter.transitionTo(`/channels/${guildId ?? "@me"}/${channelId}/0`);
}

async function jumpToLastMessage(channelId: string, guildId?: string | null) {
    const res = await RestAPI.get({
        url: Constants.Endpoints.MESSAGES(channelId),
        query: { limit: 1 }
    });
    const messageId = res.body?.[0]?.id;
    if (!messageId) return;
    NavigationRouter.transitionTo(`/channels/${guildId ?? "@me"}/${channelId}/${messageId}`);
}

async function jumpToUserMessage(channelId: string, guildId: string, userId: string, first: boolean) {
    try {
        const res = await RestAPI.get({
            url: Constants.Endpoints.SEARCH_GUILD(guildId),
            query: {
                author_id: userId,
                channel_id: channelId,
                sort_by: "timestamp",
                sort_order: first ? "asc" : "desc"
            }
        });

        const messageId = res.body?.messages?.[0]?.[0]?.id;
        if (!messageId) {
            showToast({ text: "No messages found from this user in this channel.", variant: "critical" });
            return;
        }

        NavigationRouter.transitionTo(`/channels/${guildId}/${channelId}/${messageId}`);
    } catch (e) {
        showToast({ text: "Failed to search for messages.", variant: "critical" });
    }
}

const ChannelMenuPatch: NavContextMenuPatchCallback = (
    children,
    { channel, thread }: { channel?: Channel; thread?: Channel; }
) => {
    const selectedId = SelectedChannelStore.getChannelId();
    const selectedChannel = selectedId ? ChannelStore.getChannel(selectedId) : null;
    const forumChild = channel?.isForumLikeChannel?.() && selectedChannel?.isThread?.() && selectedChannel.parent_id === channel.id
        ? selectedChannel
        : null;
    const targetChannel = thread ?? forumChild ?? channel;
    if (!targetChannel) return;

    children.push(
        <Menu.MenuItem
            id="vc-jump-to-first"
            label="Jump To First Message"
            action={() => jumpToFirstMessage(targetChannel.id, targetChannel.guild_id)}
            icon={JumpToFirstIcon}
            leadingAccessory={{ type: "icon", icon: JumpToFirstIcon }}
        />,
        <Menu.MenuItem
            id="vc-jump-to-last"
            label="Jump To Last Message"
            action={() => jumpToLastMessage(targetChannel.id, targetChannel.guild_id)}
            icon={JumpToLastIcon}
            leadingAccessory={{ type: "icon", icon: JumpToLastIcon }}
        />
    );
};

const UserMenuPatch: NavContextMenuPatchCallback = (children, { user, channel }: { user: User; channel?: Channel; }) => {
    if (!user) return;
    if (!channel || channel.guild_id) return;
    children.push(
        <Menu.MenuItem
            id="vc-jump-to-first"
            label="Jump To First Message"
            action={() => jumpToFirstMessage(channel.id, null)}
            icon={JumpToFirstIcon}
            leadingAccessory={{ type: "icon", icon: JumpToFirstIcon }}
        />,
        <Menu.MenuItem
            id="vc-jump-to-last"
            label="Jump To Last Message"
            action={() => jumpToLastMessage(channel.id, null)}
            icon={JumpToLastIcon}
            leadingAccessory={{ type: "icon", icon: JumpToLastIcon }}
        />
    );
};

const MessageMenuPatch: NavContextMenuPatchCallback = (children, { message }: { message: Message; }) => {
    if (!message) return;
    const channelId = SelectedChannelStore.getChannelId();
    const guildId = SelectedGuildStore.getGuildId();
    if (!channelId || !guildId) return;
    children.push(
        <Menu.MenuItem
            id="vc-jump-to-first-user"
            label="Jump To First Message"
            action={() => jumpToUserMessage(channelId, guildId, message.author.id, true)}
            icon={JumpToFirstIcon}
            leadingAccessory={{ type: "icon", icon: JumpToFirstIcon }}
        />,
        <Menu.MenuItem
            id="vc-jump-to-last-user"
            label="Jump To Last Message"
            action={() => jumpToUserMessage(channelId, guildId, message.author.id, false)}
            icon={JumpToLastIcon}
            leadingAccessory={{ type: "icon", icon: JumpToLastIcon }}
        />
    );
};

export default definePlugin({
    name: "JumpTo",
    description: "Adds context menu options to jump to the start or bottom of a channel/DM.",
    tags: ["Chat", "Utility"],
    authors: [Devs.Samwich, Devs.thororen],
    contextMenus: {
        "channel-context": ChannelMenuPatch,
        "gdm-context": ChannelMenuPatch,
        "thread-context": ChannelMenuPatch,
        "user-context": UserMenuPatch,
        "message": MessageMenuPatch
    }
});
