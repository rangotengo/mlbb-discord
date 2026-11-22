import { RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10";
import { ChatInputCommandInteraction, ChannelType, Role, SlashCommandBuilder, TextChannel } from "discord.js";
import { SlashCommand } from "../SlashCommand";
import { getLogger, Logger } from "../util/logger";
import { getConfig } from "../config";
import { isAllowedChannel } from "../util/channelScope";

/**
 * Looks up a role by exact or partial name match.
 * @param name - The team name to search for
 * @param guild - The guild to search roles in
 * @returns The role if found, null otherwise
 */
async function findRoleByName(name: string, guild: ChatInputCommandInteraction<"cached">["guild"]): Promise<Role | null> {
	// Try exact match first
	const exactMatch = guild.roles.cache.find(r => r.name.toLowerCase() === name.toLowerCase());
	if (exactMatch) {
		return exactMatch;
	}

	// Try partial match (role name contains the team name)
	const partialMatch = guild.roles.cache.find(r =>
		r.name.toLowerCase().includes(name.toLowerCase()) ||
		name.toLowerCase().includes(r.name.toLowerCase())
	);
	return partialMatch || null;
}

/**
 * Parses a team input string to extract role ID if it's a role mention or ID.
 * @param input - The team string (could be role mention, role ID, or plain name)
 * @param guild - The guild to fetch roles from
 * @returns Tuple of [role, displayName] - role is null if not found, displayName is the name to use
 */
async function parseTeamInput(
	input: string,
	guild: ChatInputCommandInteraction<"cached">["guild"]
): Promise<[Role | null, string]> {
	// Try to extract role ID from mention format <@&ROLE_ID>
	const roleMentionMatch = input.match(/^<@&(\d+)>$/);
	if (roleMentionMatch) {
		const roleId = roleMentionMatch[1];
		try {
			const role = await guild.roles.fetch(roleId);
			if (role) {
				return [role, role.name];
			}
		} catch {
			// Invalid role ID, fall through
		}
	}

	// Try to parse as raw role ID (snowflake)
	if (/^\d{17,19}$/.test(input)) {
		try {
			const role = await guild.roles.fetch(input);
			if (role) {
				return [role, role.name];
			}
		} catch {
			// Invalid role ID, fall through
		}
	}

	// Try to find a role by name
	const role = await findRoleByName(input, guild);
	if (role) {
		return [role, role.name];
	}

	// Not a role, return as plain string
	return [null, input];
}

export class ThreadCommand extends SlashCommand {
	#logger = getLogger("command:thread");

	constructor() {
		super();
	}

	static override get meta(): RESTPostAPIApplicationCommandsJSONBody {
		return new SlashCommandBuilder()
			.setName("thread")
			.setDescription("Create a match thread for two teams.")
			.setDefaultMemberPermissions(0)
			.addStringOption(option =>
				option.setName("team_a").setDescription("Team A name, role mention, or role ID").setRequired(true)
			)
			.addStringOption(option =>
				option.setName("team_b").setDescription("Team B name, role mention, or role ID").setRequired(true)
			)
			.addChannelOption(option =>
				option.setName("channel").setDescription("The channel to create the thread in. Defaults to current.")
			)
			.toJSON();
	}

	protected override get logger(): Logger {
		return this.#logger;
	}

	protected override async execute(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
		const teamAInput = interaction.options.getString("team_a", true);
		const teamBInput = interaction.options.getString("team_b", true);
		let targetChannel = interaction.options.getChannel("channel");

		if (!targetChannel) {
			targetChannel = interaction.channel;
		}

		if (!targetChannel || targetChannel.type !== ChannelType.GuildText || !isAllowedChannel(targetChannel)) {
			await interaction.reply({
				content: "Choose a text channel in category 1551342799276875907.",
				ephemeral: true
			});
			return;
		}

		try {
			const channel = targetChannel as TextChannel;
			const guild = interaction.guild;

			// Parse team inputs to get roles and display names
			const [roleA, teamADisplay] = await parseTeamInput(teamAInput, guild);
			const [roleB, teamBDisplay] = await parseTeamInput(teamBInput, guild);

			// Create private thread
			const threadName = `${teamADisplay} vs ${teamBDisplay}`;
			const thread = await channel.threads.create({
				name: threadName,
				autoArchiveDuration: 1440,
				type: ChannelType.PrivateThread,
				reason: `Match thread created by ${interaction.user.tag}`
			});

			// Build the initial message
			const creatorMention = interaction.user.toString();
			const teamAMention = roleA ? roleA.toString() : teamADisplay;
			const teamBMention = roleB ? roleB.toString() : teamBDisplay;

			const toRolePattern = getConfig().defaultTORole;
			let toRoleMention = toRolePattern;
			const toRole = guild.roles.cache.find(r => r.name === toRolePattern);
			if (toRole) {
				toRoleMention = `<@&${toRole.id}>`;
			}

			const threadMessage = `Match thread created by ${creatorMention}\n\n${teamAMention} vs ${teamBMention}\n\n${toRoleMention}`;

			// Send initial message to thread
			await thread.send(threadMessage);

			// Add members to the private thread
			const membersToAdd: string[] = [interaction.user.id];

			// Add role members if roles exist
			if (roleA) {
				const roleMembers = roleA.members.map(m => m.id);
				membersToAdd.push(...roleMembers);
			}
			if (roleB) {
				const roleMembers = roleB.members.map(m => m.id);
				membersToAdd.push(...roleMembers);
			}

			// Add all unique members (removing duplicates)
			const uniqueMembers = [...new Set(membersToAdd)];
			let addedCount = 0;

			for (const memberId of uniqueMembers) {
				try {
					await thread.members.add(memberId);
					addedCount++;
				} catch {
					// Silently skip members that can't be added (e.g., left server, bot permissions)
				}
			}

			// Reply with success message
			await interaction.reply({
				content: `Successfully created private match thread: <#${thread.id}> in <#${channel.id}>. Added ${addedCount} member${addedCount !== 1 ? 's' : ''}.`,
				ephemeral: false
			});
		} catch (error) {
			this.logger.error("Failed to create match thread:", error);
			await interaction.reply({
				content: "Failed to create match thread. Please check bot permissions.",
				ephemeral: true
			});
		}
	}
}
