import { LessThan, MoreThan } from "typeorm";
import { ChallongeTournament } from "../../database/orm/ChallongeTournament";
import { EnrolledPlayer } from "../../database/orm/EnrolledPlayer";
import { VerificationChallenge } from "../../database/orm/VerificationChallenge";
import { generateOtp, hashOtp, normaliseOtpInput, otpDigestSecret, otpPolicyFromEnv, verifyOtpDigest } from "../../util/otp";

export interface PlayerRef {
	tournamentId: string;
	email: string;
	name?: string | null;
	team: string;
}

export interface PlayerCandidate extends PlayerRef {
	id: number;
}

/**
 * Result of classifying enrolment records for a check-in request. Display-name
 * matches are never proof of ownership (guide 1); they are returned as
 * suggestions that still require email verification or an organiser action.
 */
export type CheckInMatch =
	| { kind: "returning"; players: EnrolledPlayer[] }
	| { kind: "suggested"; players: EnrolledPlayer[] }
	| { kind: "none" };

export interface EligibleEnrolment {
	player: EnrolledPlayer;
	tournament: ChallongeTournament;
	eligible: boolean;
	reason?: "check-in-closed" | "already-verified";
}

/** Per-tournament eligibility at the point of mutation (guide 4). */
export async function classifyEnrolments(players: EnrolledPlayer[], guildId: string): Promise<EligibleEnrolment[]> {
	const tournamentIds = [...new Set(players.map(p => p.tournamentId))];
	const tournaments = await ChallongeTournament.find({
		where: tournamentIds.map(tournamentId => ({ tournamentId, owningDiscordServer: guildId }))
	});
	const byId = new Map(tournaments.map(t => [t.tournamentId, t]));
	return players.map(player => {
		const tournament = byId.get(player.tournamentId);
		if (!tournament) {
			return { player, tournament: null as unknown as ChallongeTournament, eligible: false, reason: "check-in-closed" as const };
		}
		if (tournament.checkInDisabled) {
			return { player, tournament, eligible: false, reason: "check-in-closed" as const };
		}
		return { player, tournament, eligible: true };
	});
}

/**
 * A returning participant is one with a previously verified Discord ID for the
 * same enrolment. Name-only matches are suggestions only.
 */
export async function matchCheckIn(discordId: string, guildId: string, nameForms: string[]): Promise<CheckInMatch> {
	const tournaments = await ChallongeTournament.find({ where: { owningDiscordServer: guildId } });
	const tournamentIds = tournaments.map(t => t.tournamentId);
	if (tournamentIds.length === 0) return { kind: "none" };

	// Returning identity: verified link to this exact Discord account.
	const verified = await EnrolledPlayer.find({
		where: tournamentIds.map(tournamentId => ({ tournamentId, discordId, identityVerified: true }))
	});

	// Name matches across this guild's tournaments; still only suggestions.
	const enrolled = await EnrolledPlayer.find({
		where: tournamentIds.map(tournamentId => ({ tournamentId }))
	});
	const lowered = nameForms.map(n => n.trim().toLowerCase()).filter(Boolean);
	const verifiedIds = new Set(verified.map(player => player.id));
	const suggested = enrolled.filter(player =>
		!verifiedIds.has(player.id)
		&& !player.identityVerified
		&& player.discordUsername
		&& lowered.includes(player.discordUsername.trim().toLowerCase())
	);

	if (verified.length > 0) return { kind: "returning", players: verified };
	if (suggested.length > 0) return { kind: "suggested", players: suggested };
	return { kind: "none" };
}

export type ChallengeIssueResult =
	| { ok: true; code: string; expiresAt: Date; resendEligibleAt: Date; sends: number }
	| { ok: false; error: "cooldown"; retryAt: Date }
	| { ok: false; error: "max-sends"; sends: number }
	| { ok: false; error: "no-eligible" };

/**
 * Issues a new challenge for a subject, invalidating any predecessor.
 * The caller sends the email and records the delivery attempt separately so a
 * provider failure does not silently consume the participant's allowance.
 */
export async function issueChallenge(input: {
	discordId: string;
	guildId: string;
	email: string;
}): Promise<ChallengeIssueResult> {
	const policy = otpPolicyFromEnv();
	const email = input.email.trim().toLowerCase();

	const existing = await VerificationChallenge.findOne({
		where: { discordId: input.discordId, guildId: input.guildId, email }
	});

	const now = new Date();
	if (existing && !existing.consumed && existing.expiresAt > now) {
		if (existing.sends >= policy.maxSends) {
			return { ok: false, error: "max-sends", sends: existing.sends };
		}
		if (existing.resendEligibleAt > now) {
			return { ok: false, error: "cooldown", retryAt: existing.resendEligibleAt };
		}
	}

	const sends = existing?.consumed || (existing && existing.expiresAt <= now) ? 0 : existing?.sends ?? 0;
	const code = generateOtp();
	const expiresAt = new Date(now.getTime() + policy.expiryMs);
	const resendEligibleAt = new Date(now.getTime() + policy.resendCooldownMs);

	const challenge = existing ?? new VerificationChallenge();
	challenge.discordId = input.discordId;
	challenge.guildId = input.guildId;
	challenge.email = email;
	challenge.digest = hashOtp(code, otpDigestSecret());
	challenge.expiresAt = expiresAt;
	challenge.resendEligibleAt = resendEligibleAt;
	challenge.attempts = 0;
	challenge.sends = sends;
	challenge.deliveryAttempts = existing?.deliveryAttempts ?? 0;
	challenge.consumed = false;
	await VerificationChallenge.update({ discordId: input.discordId, guildId: input.guildId, consumed: false }, { consumed: true });
	await challenge.save();

	return { ok: true, code, expiresAt, resendEligibleAt, sends: challenge.sends };
}

/** Records whether the provider accepted the last send attempt (guide 2). */
export async function recordDeliveryAttempt(input: {
	discordId: string;
	guildId: string;
	email: string;
	accepted: boolean;
}): Promise<void> {
	const challenge = await VerificationChallenge.findOne({
		where: { discordId: input.discordId, guildId: input.guildId, email: input.email.trim().toLowerCase() }
	});
	if (!challenge) return;
	challenge.deliveryAttempts += 1;
	if (input.accepted) {
		challenge.sends += 1;
		challenge.resendEligibleAt = new Date(Date.now() + otpPolicyFromEnv().resendCooldownMs);
	}
	await challenge.save();
}

export type ChallengeVerifyResult =
	| { ok: true; email: string }
	| { ok: false; error: "malformed" | "not-found" | "expired" | "attempts-exhausted" | "mismatch"; remainingAttempts?: number };

/**
 * Verifies and atomically consumes a challenge. Concurrency-safe: the update
 * is conditional on the stored state, so two simultaneous submissions cannot
 * both succeed (guide 3.5).
 */
export async function verifyChallenge(input: {
	discordId: string;
	guildId: string;
	code: string;
}): Promise<ChallengeVerifyResult> {
	const normalised = normaliseOtpInput(input.code);
	if (!normalised) return { ok: false, error: "malformed" };

	const challenge = await VerificationChallenge.findOne({
		where: { discordId: input.discordId, guildId: input.guildId, consumed: false },
		order: { id: "DESC" }
	});
	if (!challenge || challenge.consumed) return { ok: false, error: "not-found" };
	if (challenge.expiresAt <= new Date()) return { ok: false, error: "expired" };

	const policy = otpPolicyFromEnv();
	if (challenge.attempts >= policy.maxAttempts) {
		return { ok: false, error: "attempts-exhausted" };
	}

	if (!verifyOtpDigest(normalised, challenge.digest, otpDigestSecret())) {
		await VerificationChallenge.createQueryBuilder()
			.update()
			.set({ attempts: () => '"attempts" + 1' })
			.where("id = :id", { id: challenge.id })
			.execute();
		const current = await VerificationChallenge.findOneByOrFail({ id: challenge.id });
		if (current.attempts >= policy.maxAttempts) return { ok: false, error: "attempts-exhausted" };
		return { ok: false, error: "mismatch", remainingAttempts: policy.maxAttempts - current.attempts };
	}

	const consumed = await VerificationChallenge.update(
		{ id: challenge.id, digest: challenge.digest, consumed: false, attempts: LessThan(policy.maxAttempts), expiresAt: MoreThan(new Date()) },
		{ consumed: true }
	);
	if (!consumed.affected) return { ok: false, error: "not-found" };
	return { ok: true, email: challenge.email };
}

export interface VerifyOutcome {
	tournamentId: string;
	tournamentName: string;
	success: boolean;
	stage: "identity" | "role" | "threads";
	detail?: string;
}

/**
 * Marks identity as verified for eligible enrolments, separately from access
 * provisioning. Access failures leave \`identityVerified\` set and
 * \`accessPending\` true so a retry cannot lose the verified identity (guide 1.3).
 */
export async function markIdentityVerified(
	player: EnrolledPlayer,
	by: "email" | string
): Promise<void> {
	player.identityVerified = true;
	player.identityVerifiedAt = new Date();
	player.identityVerifiedBy = by;
	player.verified = true;
	player.accessPending = true;
	player.otp = undefined;
	await player.save();
}

/** Clears the pending-access flag once the participant role is granted. */
export async function markAccessGranted(player: EnrolledPlayer): Promise<void> {
	player.accessPending = false;
	await player.save();
}
