import { getLogger } from "../../util/logger";

const logger = getLogger("email");

interface Credentials {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    tokenUri: string;
}

function getCredentials(): Credentials | null {
    // Try environment variables first (for CI/CD)
    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN) {
        return {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
            tokenUri: process.env.GOOGLE_TOKEN_URI || 'https://oauth2.googleapis.com/token',
        };
    }

    // Fallback to credentials.json for local development
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const path = require('path');
        const os = require('os');

        let credentialsPath: string;

        if (process.platform === 'win32') {
            // Windows path
            credentialsPath = 'C:/mlbb-data/credentials/credentials.json';
        } else {
            // Mac/Linux - use relative path from project root
            credentialsPath = path.join(__dirname, '../../../credentials.json');
        }

        return require(credentialsPath);
    } catch {
        return null;
    }
}

const credentials = getCredentials();

let access_token: string = '';
let expiry: Date = new Date(Date.now() - 120 * 1000);

function isTokenExpired(): boolean {
    const currentTime = new Date();
    return expiry < currentTime;
}

async function refreshAccessToken(): Promise<void> {
    if (!isTokenExpired()) return;

    if (!credentials) {
        throw new Error('Google email credentials are not configured');
    }

    logger.info('Google API access token expired. Refreshing token.');

    const payload = new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        refresh_token: credentials.refreshToken,
        grant_type: 'refresh_token',
    });

    try {
        const response = await fetch(credentials.tokenUri, {
            signal: AbortSignal.timeout(15000),
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: payload.toString(),
        });

        if (!response.ok) {
            throw new Error(`Google OAuth token refresh failed (HTTP ${response.status})`);
        }

        const responseJson = await response.json() as { access_token: string, expires_in: number };
        access_token = responseJson.access_token;
        const expiry_in: number = responseJson.expires_in;
        expiry = new Date(Date.now() + (expiry_in - 180) * 1000);
    } catch (error) {
        logger.error('Exception while refreshing access token:', error);
        throw error;
    }
}

export async function sendEmail(to: string, otp: number): Promise<void> {
    if (!credentials) {
        throw new Error('Google email credentials are not configured');
    }

    await refreshAccessToken();

    const sender = 'leagueops@nodwin.com';
    const subject = 'OTP for Discord Verification';
    const message = `Your OTP for Discord Verification is: ${otp}`;

    const messageBytes = `From: ${sender}\nTo: ${to}\nSubject: ${subject}\n\n${message}`;

    const base64Encoded = Buffer.from(messageBytes)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    const payload = { raw: base64Encoded };

    try {
        const response = await fetch('https://www.googleapis.com/gmail/v1/users/me/messages/send', {
            signal: AbortSignal.timeout(15000),
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${access_token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (response.ok) {
            logger.info(`Mail successfully sent to: ${to}, Subject: ${subject}`);
        } else {
            throw new Error(`Gmail rejected the email (HTTP ${response.status})`);
        }
    } catch (error) {
        logger.error(`Exception while sending email to ${to}:`, error);
        throw error;
    }
}
