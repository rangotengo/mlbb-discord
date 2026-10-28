import { createHmac, randomBytes, randomInt, timingSafeEqual } from "crypto";

/** Number of digits in generated codes; verification accepts exactly this many. */
export const OTP_DIGITS = 6;

export interface OtpPolicy {
	/** Challenge validity in milliseconds. */
	expiryMs: number;
	/** Cooldown between sends in milliseconds. */
	resendCooldownMs: number;
	/** Failed attempts allowed before the challenge is invalidated. */
	maxAttempts: number;
	/** Sends allowed per player before staff assistance is required. */
	maxSends: number;
}

export const DEFAULT_OTP_POLICY: OtpPolicy = {
	expiryMs: 10 * 60 * 1000,
	resendCooldownMs: 60 * 1000,
	maxAttempts: 5,
	maxSends: 3
};

/**
 * Generates a six-digit code using a cryptographic random generator.
 * Never log the return value.
 */
export function generateOtp(): string {
	const max = 10 ** OTP_DIGITS;
	return String(randomInt(0, max)).padStart(OTP_DIGITS, "0");
}

/**
 * Accepts exactly six digits with no surrounding text: the previous
 * parseInt-based check accepted a numeric prefix followed by anything.
 */
export function normaliseOtpInput(input: string): string | null {
	const trimmed = input.trim();
	return /^\d{6}$/.test(trimmed) ? trimmed : null;
}

/** Keyed digest of a code. Raw codes are never stored or logged. */
export function hashOtp(code: string, secret: string): string {
	return createHmac("sha256", secret).update(code).digest("hex");
}

/** Constant-time comparison of a presented code against a stored digest. */
export function verifyOtpDigest(code: string, digest: string, secret: string): boolean {
	const candidate = Buffer.from(hashOtp(code, secret));
	const expected = Buffer.from(digest);
	if (candidate.length !== expected.length) return false;
	return timingSafeEqual(candidate, expected);
}

/**
 * Process-wide HMAC key for OTP digests. Regenerated on restart, which
 * invalidates all in-flight codes; challenges are short-lived by design so
 * this is acceptable and avoids persisting another secret in the database.
 */
const OTP_HMAC_SECRET = process.env.OTP_HMAC_SECRET || randomBytes(32).toString("hex");

export function otpDigestSecret(): string {
	return OTP_HMAC_SECRET;
}

export function otpPolicyFromEnv(): OtpPolicy {
	const policy = { ...DEFAULT_OTP_POLICY };
	const readMs = (name: string, fallback: number): number => {
		const raw = process.env[name];
		if (!raw) return fallback;
		const value = Number(raw);
		return Number.isFinite(value) && value >= 0 ? value : fallback;
	};
	policy.expiryMs = readMs("OTP_EXPIRY_MS", policy.expiryMs);
	policy.resendCooldownMs = readMs("OTP_RESEND_COOLDOWN_MS", policy.resendCooldownMs);
	policy.maxAttempts = readMs("OTP_MAX_ATTEMPTS", policy.maxAttempts);
	policy.maxSends = readMs("OTP_MAX_SENDS", policy.maxSends);
	if (policy.maxAttempts < 1) policy.maxAttempts = 1;
	if (policy.maxSends < 1) policy.maxSends = 1;
	return policy;
}
