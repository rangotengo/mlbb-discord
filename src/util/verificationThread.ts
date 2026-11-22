import { Channel, ChannelType } from "discord.js";
import { isAllowedChannel, isConfiguredCheckInChannel } from "./channelScope";
import { TICKET_CHANNEL_PREFIX } from "./constants";

export async function isVerificationThread(channel: Channel | null | undefined): Promise<boolean> {
	return !!channel && channel.isThread() && channel.type === ChannelType.PrivateThread &&
		(isAllowedChannel(channel) || await isConfiguredCheckInChannel(channel)) && channel.name.startsWith(TICKET_CHANNEL_PREFIX);
}
