/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import "./styles.css";

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { SafetyIcon } from "@components/Icons";
import { TooltipContainer } from "@components/TooltipContainer";
import { Devs } from "@utils/constants";
import { classes } from "@utils/misc";
import definePlugin, { IconComponent, OptionType } from "@utils/types";
import type { Guild, RoleOrUserPermission } from "@vencord/discord-types";
import { PermissionOverwriteType } from "@vencord/discord-types/enums";
import { findCssClassesLazy } from "@webpack";
import { ChannelStore, Dialog, GuildMemberStore, GuildRoleStore, GuildStore, match, Menu, PermissionsBits, Popout, useEffect, useRef, UserStore } from "@webpack/common";

import openRolesAndUsersPermissionsModal from "./components/RolesAndUsersPermissions";
import UserPermissions from "./components/UserPermissions";
import { getSortedRolesForMember, loadGetGuildPermissionSpecMap, sortPermissionOverwrites } from "./utils";

const ViewPermissionsIcon: IconComponent = ({ height = 20, width = 20, className }) => {
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
                <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
            </g>
        </svg>
    );
};

const PopoutClasses = findCssClassesLazy("container", "popoutRoleDot");

export const enum PermissionsSortOrder {
    HighestRole,
    LowestRole
}

const enum MenuItemParentType {
    User,
    Channel,
    Guild
}

export const settings = definePluginSettings({
    permissionsSortOrder: {
        description: "The sort method used for defining which role grants an user a certain permission",
        type: OptionType.SELECT,
        options: [
            { label: "Highest Role", value: PermissionsSortOrder.HighestRole, default: true },
            { label: "Lowest Role", value: PermissionsSortOrder.LowestRole }
        ]
    },
});

function MenuItem(guildId: string, { id, type, withIcon }: { id?: string, type?: MenuItemParentType, withIcon?: boolean; }) {
    if (type === MenuItemParentType.User && !GuildMemberStore.isMember(guildId, id!)) return null;

    return (
        <Menu.MenuItem
            id="perm-viewer-permissions"
            label="View Permissions"
            icon={ViewPermissionsIcon}
            leadingAccessory={{ type: "icon", icon: ViewPermissionsIcon }}
            action={() => {
                const guild = GuildStore.getGuild(guildId);

                const { permissions, header } = match(type)
                    .returnType<{ permissions: RoleOrUserPermission[], header: string; }>()
                    .with(MenuItemParentType.User, () => {
                        const member = GuildMemberStore.getMember(guildId, id!)!;

                        const permissions: RoleOrUserPermission[] = getSortedRolesForMember(guild, member)
                            .map(role => ({
                                type: PermissionOverwriteType.ROLE,
                                ...role
                            }));

                        if (guild.ownerId === id) {
                            permissions.push({
                                type: PermissionOverwriteType.OWNER,
                                permissions: Object.values(PermissionsBits).reduce((prev, curr) => prev | curr, 0n)
                            });
                        }

                        return {
                            permissions,
                            header: member.nick ?? UserStore.getUser(member.userId).username
                        };
                    })
                    .with(MenuItemParentType.Channel, () => {
                        const channel = ChannelStore.getChannel(id!);

                        const permissions = sortPermissionOverwrites(Object.values(channel.permissionOverwrites).map(({ id, allow, deny, type }) => ({
                            type,
                            id,
                            overwriteAllow: allow,
                            overwriteDeny: deny
                        })), guildId);

                        return {
                            permissions,
                            header: channel.name
                        };
                    })
                    .otherwise(() => {
                        const permissions = GuildRoleStore.getSortedRoles(guild.id).map(role => ({
                            type: PermissionOverwriteType.ROLE,
                            ...role
                        }));

                        return {
                            permissions,
                            header: guild.name
                        };
                    });

                openRolesAndUsersPermissionsModal(permissions, guild, header);
            }}
        />
    );
}

function makeContextMenuPatch(childId: string | string[], type?: MenuItemParentType, withIcon = false): NavContextMenuPatchCallback {
    return (children, props) => {
        if (
            !props ||
            (type === MenuItemParentType.User && !props.user) ||
            (type === MenuItemParentType.Guild && !props.guild) ||
            (type === MenuItemParentType.Channel && (!props.channel || !props.guild))
        ) {
            return;
        }

        const group = findGroupChildrenByChildId(childId, children);

        const item = match(type)
            .with(MenuItemParentType.User, () => MenuItem(props.guildId, { id: props.user.id, type, withIcon }))
            .with(MenuItemParentType.Channel, () => MenuItem(props.guild.id, { id: props.channel.id, type, withIcon }))
            .with(MenuItemParentType.Guild, () => MenuItem(props.guild.id, { withIcon }))
            .otherwise(() => null);

        if (item == null) return;

        if (group) {
            return children.push(item);
        }

        // "roles" may not be present due to the member not having any roles. In that case, add it above "Copy ID"
        if (childId === "roles" && props.guildId) {
            children.splice(-1, 0, <Menu.MenuGroup>{item}</Menu.MenuGroup>);
        }
    };
}

export default definePlugin({
    name: "PermissionsViewer",
    description: "View the permissions a user or channel has, and the roles of a server",
    tags: ["Servers", "Roles", "Utility"],
    authors: [Devs.Nuckyz, Devs.Ven],
    settings,

    patches: [
        {
            find: "#{intl::COLLAPSE_ROLES}",
            replacement: {
                match: /(?<=\i\.id\)\),\i\(\))(?=,\i\?)/,
                replace: ",$self.ViewPermissionsButton(arguments[0])"
            }
        }
    ],

    ViewPermissionsButton: ErrorBoundary.wrap(({ className, guild, userId }: { className: string; guild: Guild; userId: string; }) => {
        const buttonRef = useRef(null);
        useEffect(() => void loadGetGuildPermissionSpecMap(), []);

        const guildMember = GuildMemberStore.getMember(guild.id, userId);
        if (!guildMember) return null;

        return (
            <Popout
                position="bottom"
                align="center"
                targetElementRef={buttonRef}
                renderPopout={({ closePopout }) => (
                    <Dialog className={PopoutClasses.container} style={{ width: "500px" }}>
                        <UserPermissions guild={guild} guildMember={guildMember} closePopout={closePopout} />
                    </Dialog>
                )}
            >
                {popoutProps => (
                    <TooltipContainer text="View Permissions">
                        <Button
                            {...popoutProps}
                            ref={buttonRef}
                            variant="none"
                            size="min"
                            className={classes(className, "vc-permviewer-role-button")}
                        >
                            <SafetyIcon height="16" width="16" />
                        </Button>
                    </TooltipContainer>
                )}
            </Popout>
        );
    }, { noop: true }),

    contextMenus: {
        "user-context": makeContextMenuPatch("roles", MenuItemParentType.User),
        "channel-context": makeContextMenuPatch(["mute-channel", "unmute-channel"], MenuItemParentType.Channel),
        "guild-context": makeContextMenuPatch("privacy", MenuItemParentType.Guild),
        "guild-header-popout": makeContextMenuPatch("privacy", MenuItemParentType.Guild, true)
    }
});
