/**
 * SMS service using Twilio Verify.
 * Sends and checks password reset codes via Twilio's Verify API,
 * which handles A2P 10DLC compliance automatically.
 *
 * Required environment variables:
 *   TWILIO_ACCOUNT_SID    - Your Twilio Account SID
 *   TWILIO_AUTH_TOKEN      - Your Twilio Auth Token
 *   TWILIO_VERIFY_SID      - Your Twilio Verify Service SID (starts with VA)
 */

let twilioClient = null;

function getClient() {
    if (twilioClient) return twilioClient;

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) {
        return null;
    }

    try {
        const twilio = require('twilio');
        twilioClient = twilio(accountSid, authToken);
        return twilioClient;
    } catch (err) {
        console.error('Failed to initialize Twilio client:', err.message);
        return null;
    }
}

/**
 * Send a verification code to a phone number via Twilio Verify.
 * Twilio generates and manages the code automatically.
 * @param {string} phone - Phone number in E.164 format (e.g. +12345678901)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function sendVerification(phone) {
    const client = getClient();
    if (!client) {
        return { success: false, error: 'SMS service not configured' };
    }

    const verifySid = process.env.TWILIO_VERIFY_SID;
    if (!verifySid) {
        return { success: false, error: 'Verify service not configured' };
    }

    try {
        await client.verify.v2
            .services(verifySid)
            .verifications.create({ to: phone, channel: 'sms' });
        return { success: true };
    } catch (err) {
        console.error('Twilio Verify send error:', err.message);
        return { success: false, error: 'Failed to send verification code' };
    }
}

/**
 * Check a verification code against Twilio Verify.
 * @param {string} phone - Phone number in E.164 format
 * @param {string} code - The 6-digit code the user entered
 * @returns {Promise<{success: boolean, valid: boolean, error?: string}>}
 */
async function checkVerification(phone, code) {
    const client = getClient();
    if (!client) {
        return { success: false, valid: false, error: 'SMS service not configured' };
    }

    const verifySid = process.env.TWILIO_VERIFY_SID;
    if (!verifySid) {
        return { success: false, valid: false, error: 'Verify service not configured' };
    }

    try {
        const check = await client.verify.v2
            .services(verifySid)
            .verificationChecks.create({ to: phone, code: code });
        return { success: true, valid: check.status === 'approved' };
    } catch (err) {
        console.error('Twilio Verify check error:', err.message);
        return { success: false, valid: false, error: 'Failed to check verification code' };
    }
}

/**
 * Check if SMS service is properly configured.
 */
function isConfigured() {
    return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_VERIFY_SID);
}

module.exports = { sendVerification, checkVerification, isConfigured };
