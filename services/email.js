/**
 * Email service using SendGrid HTTP API.
 * Sends admin notifications, invite code emails, and verification emails.
 *
 * Required environment variables:
 *   SENDGRID_API_KEY    - SendGrid API key (starts with SG.)
 *   SENDGRID_FROM_EMAIL - Verified sender email address
 *   SENDGRID_FROM_NAME  - Sender display name (optional, defaults to "Metal Detector Location Tracker")
 */

const sgMail = require('@sendgrid/mail');

let configured = null;
let configuredApiKey = null;

function setup() {
    const apiKey = process.env.SENDGRID_API_KEY;
    const fromEmail = process.env.SENDGRID_FROM_EMAIL;

    // Re-check if previously unconfigured or if the API key changed
    if (configured === true && configuredApiKey === apiKey) return true;

    if (!apiKey || !fromEmail) {
        configured = false;
        return false;
    }

    try {
        sgMail.setApiKey(apiKey);
        configured = true;
        configuredApiKey = apiKey;
        return true;
    } catch (err) {
        console.error('Failed to initialize SendGrid:', err.message);
        configured = false;
        return false;
    }
}

/**
 * Send an email via SendGrid.
 * @param {object} options - { to, subject, html }
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function sendEmail({ to, subject, html }) {
    if (!setup()) {
        return { success: false, error: 'Email service not configured' };
    }

    const fromEmail = process.env.SENDGRID_FROM_EMAIL;
    const fromName = process.env.SENDGRID_FROM_NAME || 'Metal Detector Location Tracker';

    try {
        await sgMail.send({
            to,
            from: { email: fromEmail, name: fromName },
            subject,
            html,
        });
        return { success: true };
    } catch (err) {
        console.error('Email send error:', err.message);
        if (err.response) {
            console.error('SendGrid response:', JSON.stringify(err.response.body));
        }
        return { success: false, error: 'Failed to send email' };
    }
}

/**
 * Send a new-user registration notification to the admin.
 */
async function sendRegistrationNotification(userData, adminEmail) {
    const subject = 'New User Registered: ' + userData.display_name;
    const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 500px;">
            <h2 style="color: #6b4f36; margin-bottom: 16px;">New User Registration</h2>
            <table style="border-collapse: collapse; width: 100%;">
                <tr>
                    <td style="padding: 8px 12px; font-weight: bold; color: #374151;">Display Name</td>
                    <td style="padding: 8px 12px;">${esc(userData.display_name)}</td>
                </tr>
                <tr style="background: #f9fafb;">
                    <td style="padding: 8px 12px; font-weight: bold; color: #374151;">Email</td>
                    <td style="padding: 8px 12px;">${esc(userData.email)}</td>
                </tr>
                <tr style="background: #f9fafb;">
                    <td style="padding: 8px 12px; font-weight: bold; color: #374151;">Registered At</td>
                    <td style="padding: 8px 12px;">${esc(userData.timestamp)}</td>
                </tr>
            </table>
            <p style="color: #6b7280; font-size: 13px; margin-top: 16px;">
                &mdash; Metal Detector Location Tracker
            </p>
        </div>
    `;
    return sendEmail({ to: adminEmail, subject, html });
}

/**
 * Send a notification to the admin when someone requests an invite code.
 */
async function sendInviteRequestNotification(requestData, adminEmail) {
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const subject = 'Invite Code Request from ' + requestData.name;
    const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 500px;">
            <h2 style="color: #6b4f36; margin-bottom: 16px;">Invite Code Request</h2>
            <p style="color: #374151;">Someone wants to join Metal Detector Location Tracker:</p>
            <table style="border-collapse: collapse; width: 100%;">
                <tr>
                    <td style="padding: 8px 12px; font-weight: bold; color: #374151;">Name</td>
                    <td style="padding: 8px 12px;">${esc(requestData.name)}</td>
                </tr>
                <tr style="background: #f9fafb;">
                    <td style="padding: 8px 12px; font-weight: bold; color: #374151;">Email</td>
                    <td style="padding: 8px 12px;">${esc(requestData.email)}</td>
                </tr>
                ${requestData.message ? `
                <tr>
                    <td style="padding: 8px 12px; font-weight: bold; color: #374151;">Message</td>
                    <td style="padding: 8px 12px;">${esc(requestData.message)}</td>
                </tr>
                ` : ''}
            </table>
            <p style="margin-top: 16px;">
                <a href="${baseUrl}/admin.html" style="background: #6b4f36; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none; display: inline-block;">Review in Admin Panel</a>
            </p>
            <p style="color: #6b7280; font-size: 13px; margin-top: 16px;">
                &mdash; Metal Detector Location Tracker
            </p>
        </div>
    `;
    return sendEmail({ to: adminEmail, subject, html });
}

/**
 * Send an approved invite code to the requester.
 */
async function sendInviteCodeToRequester(code, requesterEmail, requesterName) {
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const signupUrl = baseUrl + '/login.html?code=' + encodeURIComponent(code) + '#register';
    const subject = 'Your Metal Detector Location Tracker Invite Code';
    const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 500px;">
            <h2 style="color: #6b4f36; margin-bottom: 16px;">You're Invited!</h2>
            <p style="color: #374151;">Hi ${esc(requesterName)},</p>
            <p style="color: #374151;">Thank you for your interest in Metal Detector Location Tracker! Your request has been approved and we're excited to have you join us.</p>
            <p style="color: #374151;">Here's your invite code:</p>
            <div style="background: #f3f4f6; border: 2px solid #6b4f36; border-radius: 8px; padding: 16px; text-align: center; margin: 16px 0;">
                <span style="font-family: monospace; font-size: 24px; font-weight: bold; letter-spacing: 4px; color: #6b4f36;">${esc(code)}</span>
            </div>
            <p style="text-align: center; margin: 20px 0;">
                <a href="${signupUrl}" style="background: #6b4f36; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block; font-weight: bold;">Register Now</a>
            </p>
            <div style="background: #fffbeb; border: 1px solid #f59e0b; border-radius: 6px; padding: 12px; margin: 16px 0;">
                <p style="color: #92400e; font-size: 13px; margin: 0;"><strong>⚠️ Beta Notice:</strong> Signal Bouncer is currently in beta. Things might not always work as expected, and we appreciate your patience as we continue to improve. If you run into any issues, please don't hesitate to let us know!</p>
            </div>
            <p style="color: #6b7280; font-size: 13px; margin-top: 16px;">
                &mdash; The Signal Bouncer Team
            </p>
        </div>
    `;
    return sendEmail({ to: requesterEmail, subject, html });
}

/**
 * Send a notification to the admin when a user submits feedback.
 */
async function sendFeedbackNotification(feedbackData, adminEmail) {
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const typeLabel = (feedbackData.type || 'suggestion').charAt(0).toUpperCase() + (feedbackData.type || 'suggestion').slice(1);
    const subject = 'New Feedback: ' + typeLabel + ' from ' + feedbackData.display_name;
    const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 500px;">
            <h2 style="color: #6b4f36; margin-bottom: 16px;">New User Feedback</h2>
            <table style="border-collapse: collapse; width: 100%;">
                <tr>
                    <td style="padding: 8px 12px; font-weight: bold; color: #374151;">From</td>
                    <td style="padding: 8px 12px;">${esc(feedbackData.display_name)}</td>
                </tr>
                <tr style="background: #f9fafb;">
                    <td style="padding: 8px 12px; font-weight: bold; color: #374151;">Type</td>
                    <td style="padding: 8px 12px;">${esc(typeLabel)}</td>
                </tr>
                <tr>
                    <td style="padding: 8px 12px; font-weight: bold; color: #374151;">Message</td>
                    <td style="padding: 8px 12px;">${esc(feedbackData.message)}</td>
                </tr>
                <tr style="background: #f9fafb;">
                    <td style="padding: 8px 12px; font-weight: bold; color: #374151;">Page</td>
                    <td style="padding: 8px 12px;">${esc(feedbackData.page_url || 'N/A')}</td>
                </tr>
            </table>
            <p style="margin-top: 16px;">
                <a href="${baseUrl}/admin.html" style="background: #6b4f36; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none; display: inline-block;">View in Admin Panel</a>
            </p>
            <p style="color: #6b7280; font-size: 13px; margin-top: 16px;">
                &mdash; Metal Detector Location Tracker
            </p>
        </div>
    `;
    return sendEmail({ to: adminEmail, subject, html });
}

/**
 * Send a verification email with a 6-digit code.
 */
async function sendVerificationEmail(email, displayName, code) {
    const subject = 'Verify your email \u2014 Metal Detector Location Tracker';
    const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 500px;">
            <h2 style="color: #6b4f36; margin-bottom: 16px;">Verify Your Email</h2>
            <p style="color: #374151;">Hi ${esc(displayName)},</p>
            <p style="color: #374151;">Thanks for registering with Metal Detector Location Tracker! Enter the code below to verify your email address:</p>
            <div style="background: #f3f4f6; border: 2px solid #6b4f36; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
                <span style="font-family: monospace; font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #6b4f36;">${esc(code)}</span>
            </div>
            <p style="color: #374151; font-size: 14px;">This code expires in 30 minutes.</p>
            <p style="color: #6b7280; font-size: 13px; margin-top: 16px;">
                If you didn't create an account, you can safely ignore this email.
            </p>
            <p style="color: #6b7280; font-size: 13px; margin-top: 16px;">
                &mdash; Metal Detector Location Tracker
            </p>
        </div>
    `;
    return sendEmail({ to: email, subject, html });
}

/**
 * Send a password reset email with a 6-digit code.
 */
async function sendPasswordResetEmail(email, displayName, code) {
    const subject = 'Password Reset \u2014 Metal Detector Location Tracker';
    const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 500px;">
            <h2 style="color: #6b4f36; margin-bottom: 16px;">Reset Your Password</h2>
            <p style="color: #374151;">Hi ${esc(displayName)},</p>
            <p style="color: #374151;">We received a request to reset your password. Enter the code below to set a new password:</p>
            <div style="background: #f3f4f6; border: 2px solid #6b4f36; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
                <span style="font-family: monospace; font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #6b4f36;">${esc(code)}</span>
            </div>
            <p style="color: #374151; font-size: 14px;">This code expires in 15 minutes.</p>
            <p style="color: #6b7280; font-size: 13px; margin-top: 16px;">
                If you didn't request a password reset, you can safely ignore this email.
            </p>
            <p style="color: #6b7280; font-size: 13px; margin-top: 16px;">
                &mdash; Metal Detector Location Tracker
            </p>
        </div>
    `;
    return sendEmail({ to: email, subject, html });
}

/**
 * Check if email service is properly configured.
 */
function isConfigured() {
    return !!(process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL);
}

function esc(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

module.exports = {
    sendEmail,
    sendRegistrationNotification,
    sendInviteRequestNotification,
    sendInviteCodeToRequester,
    sendFeedbackNotification,
    sendVerificationEmail,
    sendPasswordResetEmail,
    isConfigured,
};
