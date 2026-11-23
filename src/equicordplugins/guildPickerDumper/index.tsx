/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Devs, EquicordDevs } from "@utils/constants";
import definePlugin, { IconComponent } from "@utils/types";
import type { Guild } from "@vencord/discord-types";
import { EmojiStore, Menu, StickersStore } from "@webpack/common";
import { zipSync } from "fflate";

const DownloadEmojisIcon: IconComponent = ({ height = 20, width = 20, className }) => {
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
                <path d="M15 10V9" />
                <path d="M8 16h8" />
                <path d="M9 10V9" />
                <circle cx="12"
                    cy="12"
                    r="10" />
            </g>
        </svg>
    );
};

const DownloadStickersIcon: IconComponent = ({ height = 20, width = 20, className }) => {
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
                <path d="M21 9a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z" />
                <path d="M15 3v5a1 1 0 0 0 1 1h5" />
                <path d="M8 13h.01" />
                <path d="M16 13h.01" />
                <path d="M10 16s.8 1 2 1c1.3 0 2-1 2-1" />
            </g>
        </svg>
    );
};

const StickerExt = [, "png", "apng", "json", "gif"] as const;

const Patch: NavContextMenuPatchCallback = (children, { guild }: { guild: Guild; }) => {
    // Assuming "privacy" is the correct ID for the group you want to modify.
    const group = findGroupChildrenByChildId("privacy", children);

    if (group) {
        group.push(
            <>
                <Menu.MenuItem id="emoji.download" label="Download Emojis" action={() => zipGuildAssets(guild, "emojis")} icon={DownloadEmojisIcon} leadingAccessory={{ type: "icon", icon: DownloadEmojisIcon }}></Menu.MenuItem>
                <Menu.MenuItem id="sticker.download" label="Download Stickers" action={() => zipGuildAssets(guild, "stickers")} icon={DownloadStickersIcon} leadingAccessory={{ type: "icon", icon: DownloadStickersIcon }}></Menu.MenuItem>
            </>
        );
    }
};

async function zipGuildAssets(guild: Guild, type: "emojis" | "stickers") {
    const isEmojis = type === "emojis";
    const items = isEmojis
        ? EmojiStore.getGuilds()[guild.id]?.emojis
        : StickersStore.getStickersByGuildId(guild.id);

    if (!items) {
        return console.log("Server not found!");
    }

    const getProxyEndpoint = () => {
        const rawEndpoint = window.GLOBAL_ENV.MEDIA_PROXY_ENDPOINT;
        return rawEndpoint.startsWith("//") ? rawEndpoint.slice(2) : rawEndpoint;
    };

    const fetchAsset = async (e: any) => {
        let ext: string;
        let url: string;
        const endpoint = getProxyEndpoint();

        if (isEmojis) {
            ext = e.animated ? ".gif" : ".png";
            url = `https://${endpoint}/emojis/${e.id}${ext}?size=512&quality=lossless`;
        } else {
            ext = "." + StickerExt[e.format_type];
            const urlExt = e.format_type === 2 ? ".png" : ext;
            url = `https://${endpoint}/stickers/${e.id}${urlExt}?size=4096&lossless=true`;
        }

        const sanitizedName = e.name.replace(/[<>:"/\\|?*]/g, "_");
        let filename = `${sanitizedName}_${e.id}${ext}`;

        let response = await fetch(url);

        if (!isEmojis && e.format_type === 2 && (!response.ok || response.headers.get("content-type")?.includes("text"))) {
            const gifUrl = `https://${endpoint}/stickers/${e.id}.gif?size=4096&lossless=true`;
            const gifResponse = await fetch(gifUrl);

            if (gifResponse.ok && !gifResponse.headers.get("content-type")?.includes("text")) {
                response = gifResponse;
                ext = ".gif";
                filename = `${sanitizedName}_${e.id}${ext}`;
            }
        }

        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();
        return { file: new Uint8Array(arrayBuffer), filename };
    };

    const assetPromises = items.map(e => fetchAsset(e));

    Promise.all(assetPromises)
        .then(results => {
            const zipped = zipSync(Object.fromEntries(results.map(({ file, filename }) => [filename, file])));
            const blob = new Blob([new Uint8Array(zipped)], { type: "application/zip" });
            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = objectUrl;
            link.download = `${guild.name}-${type}.zip`;
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        })
        .catch(console.error);
}

export default definePlugin({
    name: "GuildPickerDumper",
    description: "Context menu to dump and download a server's emojis and stickers.",
    tags: ["Emotes", "Servers", "Utility"],
    authors: [EquicordDevs.Cortex, Devs.Samwich, EquicordDevs.Synth, Devs.thororen],
    contextMenus: {
        "guild-context": Patch,
        "guild-header-popout": Patch
    }
});
