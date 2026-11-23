/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addContextMenuPatch, NavContextMenuPatchCallback, removeContextMenuPatch } from "@api/ContextMenu";
import { updateMessage } from "@api/MessageUpdater";
import { FluxDispatcher, Menu, MessageActions, React, showToast, SortedGuildStore, UserStore } from "@webpack/common";

import { addToXAndRemoveFromOpposite, ListType, removeFromX } from ".";
import { openLogModal } from "../components/LogsModal";
import { deleteMessageIDB } from "../db";
import { settings } from "../index";
import { IconComponent } from "@utils/types";

const MessageLoggerIcon: IconComponent = ({ height = 20, width = 20, className }) => {
    return (
        <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            width={width}
            height={height}
            className={className}
        >
            <g transform="translate(0 0) scale(0.833333) translate(0 0)">
                <path d="M19 17V5a2 2 0 0 0-2-2H4" />
                <path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3" />
            </g>
        </svg>
    );
};

const idFunctions = {
    Folder: props =>
        props?.folderId &&
        SortedGuildStore.getGuildFolders().find(f => f?.folderId === props.folderId)?.guildIds,
    Server: props => props?.guild?.id,
    User: props => props?.message?.author?.id || props?.user?.id,
    Channel: props => props.message?.channel_id || props.channel?.id
} as Record<string, (props: any) => string | string[] | null | undefined>;

type idKeys = keyof typeof idFunctions;

function renderListOption(listType: ListType, IdType: idKeys, props: any) {
    const rawId = idFunctions[IdType](props);
    if (!rawId) return null;

    const ids = Array.isArray(rawId) ? rawId : [rawId];

    const isBlocked = ids.every(id => settings.store[listType].includes(id));
    const oppositeListType = listType === "blacklistedIds" ? "whitelistedIds" : "blacklistedIds";
    const isOppositeBlocked = ids.some(id => settings.store[oppositeListType].includes(id));
    const list = listType === "blacklistedIds" ? "Blacklist" : "Whitelist";

    const addToList = () => ids.forEach(id => addToXAndRemoveFromOpposite(listType, id));
    const removeFromList = () => ids.forEach(id => removeFromX(listType, id));

    return (
        <Menu.MenuItem
            id={`${listType}-${IdType}-${ids[0]}`}
            label={
                isOppositeBlocked
                    ? `Move ${IdType} to ${list}`
                    : isBlocked ? `Remove ${IdType} From ${list}` : `${list} ${IdType}`
            }
            action={isBlocked ? removeFromList : addToList}
        />
    );
}

function renderOpenLogs(idType: idKeys, props: any) {
    const id = idFunctions[idType](props);
    // TODO: rewrite logs modal to accept arrays
    if (!id || Array.isArray(id)) return null;

    return (
        <Menu.MenuItem
            id={`open-logs-for-${idType.toLowerCase()}`}
            label={`Open Logs For ${idType}`}
            action={() => openLogModal(`${idType.toLowerCase()}:${id}`)}
        />
    );
}

const removeMessageAction = async (props: any) => {
    try {
        await deleteMessageIDB(props.message.id);
        if (props.message.deleted) {
            FluxDispatcher.dispatch({
                type: "MESSAGE_DELETE",
                channelId: props.message.channel_id,
                id: props.message.id,
                mlDeleted: true
            });
        } else {
            updateMessage(props.message.channel_id, props.message.id, { editHistory: [] });
        }
    } catch (e) {
        console.error("Failed to remove message", e);
        showToast({ text: "Failed to remove message. Check console for details.", variant: "critical" });
    }
};

export const contextMenuPath: NavContextMenuPatchCallback = (children, props) => {
    if (!props) return;

    if (!children.some(child => child?.props?.id === "message-logger")) {
        if (settings.store.permanentlyRemoveLogByDefault) {
            const mlRemoveHistory = children.find(c => c?.props?.id === "ml-remove-history");
            if (mlRemoveHistory) {
                mlRemoveHistory.props.action = () => removeMessageAction(props);
            }
        }

        children.push(
            <Menu.MenuSeparator />,
            <Menu.MenuItem
                id="message-logger"
                label="Message Logger"
                icon={MessageLoggerIcon}
                leadingAccessory={{ type: "icon", icon: MessageLoggerIcon }}
            >

                <Menu.MenuItem
                    id="open-logs"
                    label="Open Logs"
                    action={() => openLogModal()}
                />

                {Object.keys(idFunctions).map(IdType => renderOpenLogs(IdType as idKeys, props))}

                <Menu.MenuSeparator />

                {Object.keys(idFunctions).map(IdType => (
                    <React.Fragment key={IdType}>
                        {renderListOption("blacklistedIds", IdType as idKeys, props)}
                        {renderListOption("whitelistedIds", IdType as idKeys, props)}
                    </React.Fragment>
                ))}

                {
                    props.navId === "message"
                    && (props.message?.deleted || props.message?.editHistory?.length > 0)
                    && (
                        <>
                            <Menu.MenuSeparator />
                            <Menu.MenuItem
                                id="remove-message"
                                label={props.message?.deleted ? "Remove Message (Permanent)" : "Remove Message History (Permanent)"}
                                color="danger"
                                action={() => removeMessageAction(props)}
                            />
                        </>
                    )
                }

                {
                    settings.store.hideMessageFromMessageLoggers
                    && props.navId === "message"
                    && props.message?.author?.id === UserStore.getCurrentUser().id
                    && props.message?.deleted === false
                    && (
                        <>
                            <Menu.MenuSeparator />
                            <Menu.MenuItem
                                id="hide-from-message-loggers"
                                label="Delete Message (Hide From Message Loggers)"
                                color="danger"

                                action={async () => {
                                    await MessageActions.deleteMessage(props.message.channel_id, props.message.id);
                                    MessageActions._sendMessage(props.message.channel_id, {
                                        "content": settings.store.hideMessageFromMessageLoggersDeletedMessage,
                                        "tts": false,
                                        "invalidEmojis": [],
                                        "validNonShortcutEmojis": []
                                    }, { nonce: props.message.id });
                                }}
                            />
                        </>
                    )
                }
            </Menu.MenuItem>
        );
    }
};

export const setupContextMenuPatches = () => {
    addContextMenuPatch("message", contextMenuPath);
    addContextMenuPatch("channel-context", contextMenuPath);
    addContextMenuPatch("user-context", contextMenuPath);
    addContextMenuPatch("guild-context", contextMenuPath);
    addContextMenuPatch("gdm-context", contextMenuPath);
};

export const removeContextMenuBindings = () => {
    removeContextMenuPatch("message", contextMenuPath);
    removeContextMenuPatch("channel-context", contextMenuPath);
    removeContextMenuPatch("user-context", contextMenuPath);
    removeContextMenuPatch("guild-context", contextMenuPath);
    removeContextMenuPatch("gdm-context", contextMenuPath);
};
