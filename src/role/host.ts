import { Client, Guild, Role } from "discord.js";
import { PermissionFlagsBits } from "discord-api-types/v10";
import { getLogger } from "../util/logger";

const logger = getLogger("role:host");

type HostRole = {
	id: string;
	server: Guild;
};

type Tournament = {
	id: string;
	server: string;
};

/**
 * Creates the server role that identifies tournament hosts/admins.
 * This role is created per tournament and grants admin permissions.
 */
export class HostRoleProvider {
	protected roleCache: Record<string, HostRole> = {};

	constructor(protected readonly bot: Client, readonly color?: number) {}

	public forget(tournamentId: string): void {
		delete this.roleCache[tournamentId];
	}

	/**
	 * Creates the host/admin role in question on the specified server for the specified tournament.
	 *
	 * @param server The server to create the role in
	 * @param tournamentId Unique label
	 * @returns The created role
	 */
	private async create(server: Guild, tournamentId: string): Promise<Role> {
		const role = await server.roles.create({
			name: `${tournamentId}-admin`,
			color: this.color,
			permissions: [
				PermissionFlagsBits.ManageThreads,
				PermissionFlagsBits.SendMessagesInThreads,
				PermissionFlagsBits.ManageMessages,
				PermissionFlagsBits.ManageRoles,
				PermissionFlagsBits.MentionEveryone,
			],
			reason: `Auto-created host role for tournament ${tournamentId} by Dot.`
		});
		logger.verbose(`Host role ${role.name} (${role.id}) created in ${server.name} (${server.id}).`);
		return role;
	}

	/**
	 * Retrieve the host role and cache it, or create it if it does not exist.
	 *
	 * @param tournament Unique tournament label and Discord guild snowflake
	 * @returns Role snowflake and guild snowflake as cached
	 */
	protected async lazyGet(tournament: Tournament): Promise<HostRole> {
		if (tournament.id in this.roleCache) {
			return this.roleCache[tournament.id];
		}
		const server = await this.bot.guilds.fetch(tournament.server);
		logger.verbose(
			JSON.stringify({
				method: "get",
				tournament: tournament.id,
				server: tournament.server,
				event: "cache miss"
			})
		);
		const role =
			server.roles.cache.find(r => r.name === `${tournament.id}-admin`) ||
			(await this.create(server, tournament.id));
		return (this.roleCache[tournament.id] = { id: role.id, server });
	}

	/**
	 * Retrieve the host role and cache it, or create it if it does not exist.
	 *
	 * @param tournament Unique tournament label and Discord guild snowflake
	 * @returns Role snowflake
	 */
	public async get(tournament: Tournament): Promise<string> {
		return (await this.lazyGet(tournament)).id;
	}

	/**
	 * Assign the corresponding tournament host role (idempotent), creating it if it does not exist.
	 *
	 * @param userId User snowflake
	 * @param tournament Unique tournament label and Discord guild snowflake
	 */
	public async grant(userId: string, tournament: Tournament): Promise<void> {
		const { id, server } = await this.lazyGet(tournament);
		try {
			const member = await server.members.fetch(userId);
			await member.roles.add(id, `Granted host role for tournament ${tournament.id} by Dot.`);
			logger.info(`Granted host role ${id} to user ${userId} for tournament ${tournament.id}`);
		} catch (error) {
			logger.warn(`Failed to grant host role to user ${userId}: user not in server ${server.name} (${server.id})`);
			throw error;
		}
	}

	/**
	 * Remove the corresponding tournament host role (idempotent).
	 *
	 * @param userId User snowflake
	 * @param tournament Unique tournament label and Discord guild snowflake
	 */
	public async ungrant(userId: string, tournament: Tournament): Promise<void> {
		const { id, server } = await this.lazyGet(tournament);
		try {
			const member = await server.members.fetch(userId);
			await member.roles.remove(id, `Revoked host role for tournament ${tournament.id} by Dot.`);
			logger.info(`Revoked host role ${id} from user ${userId} for tournament ${tournament.id}`);
		} catch (error) {
			logger.warn(`Failed to revoke host role from user ${userId}: user not in server ${server.name} (${server.id})`);
			throw error;
		}
	}

	/**
	 * Delete the corresponding host role for the specified tournament.
	 * Exceptions are absorbed.
	 *
	 * @param tournament Unique tournament label and Discord guild snowflake
	 */
	public async delete(tournament: Tournament): Promise<void> {
		logger.verbose(
			JSON.stringify({
				method: "delete",
				tournament: tournament.id,
				server: tournament.server,
				event: "attempt"
			})
		);
		if (tournament.id in this.roleCache) {
			const { id, server } = this.roleCache[tournament.id];
			try {
				const role = await server.roles.fetch(id);
				if (role) {
					await role.delete();
				} else {
					logger.warn(`Host role ${id} not found in server ${server.name} (${server.id}), skipping deletion`);
				}
			} catch (e) {
				logger.error(e);
			}
			delete this.roleCache[tournament.id];
			logger.info(
				JSON.stringify({
					method: "delete",
					tournament: tournament.id,
					server: tournament.server,
					serverName: server.name,
					event: "success"
				})
			);
			return;
		} else {
			const server = this.bot.guilds.cache.get(tournament.server);
			if (!server) {
				logger.error(new Error(`Could not find server ${tournament.server}.`));
				return;
			}
			const role = server.roles.cache.find(r => r.name === `${tournament.id}-admin`);
			if (role) {
				try {
					await role.delete();
				} catch (e) {
					logger.error(e);
				}
				logger.info(
					JSON.stringify({
						method: "delete",
						tournament: tournament.id,
						server: tournament.server,
						serverName: server.name,
						event: "success, cache miss"
					})
				);
			} else {
				logger.warn(
					JSON.stringify({
						method: "delete",
						tournament: tournament.id,
						server: tournament.server,
						serverName: server.name,
						event: "not found"
					})
				);
			}
		}
	}
}
