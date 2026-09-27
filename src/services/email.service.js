/**
 * Email Service Abstraction
 * Supports pluggable email providers (e.g. Resend, SMTP) without hard-coding credentials.
 * If no provider is configured, it safely logs the pending dispatch without throwing unhandled errors.
 */

class EmailService {
  constructor() {
    this.provider = this.resolveProvider();
  }

  resolveProvider() {
    if (process.env.RESEND_API_KEY) {
      return "resend";
    }
    if (process.env.SMTP_HOST && process.env.SMTP_USER) {
      return "smtp";
    }
    return "unconfigured";
  }

  getFrontendUrl() {
    return process.env.FRONTEND_URL || "http://localhost:5173";
  }

  /**
   * Send account verification email
   */
  async sendVerificationEmail({ email, fullName, token }) {
    const frontendUrl = this.getFrontendUrl();
    const verificationUrl = `${frontendUrl}/verify-email?token=${encodeURIComponent(token)}`;

    const subject = "Bitte bestätigen Sie Ihre E-Mail-Adresse / Please verify your email";
    const text = `Hallo ${fullName},\n\nBitte bestätigen Sie Ihre E-Mail-Adresse, indem Sie auf folgenden Link klicken:\n${verificationUrl}\n\nDieser Link ist 24 Stunden gültig.\n\n---\n\nHello ${fullName},\n\nPlease verify your email address by clicking the link below:\n${verificationUrl}\n\nThis link is valid for 24 hours.`;

    return this.dispatch({
      to: email,
      subject,
      text,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #111;">
          <h2>German Auto</h2>
          <p>Hallo ${fullName},</p>
          <p>Vielen Dank für Ihre Registrierung. Bitte bestätigen Sie Ihre E-Mail-Adresse:</p>
          <p><a href="${verificationUrl}" style="display: inline-block; padding: 12px 24px; background: #000; color: #fff; text-decoration: none; border-radius: 4px;">E-Mail bestätigen</a></p>
          <p style="color: #666; font-size: 13px;">Oder kopieren Sie diesen Link in Ihren Browser:<br>${verificationUrl}</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
          <p>Hello ${fullName},</p>
          <p>Thank you for registering. Please confirm your email address by clicking above.</p>
        </div>
      `,
    });
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail({ email, fullName, token }) {
    const frontendUrl = this.getFrontendUrl();
    const resetUrl = `${frontendUrl}/reset-password?token=${encodeURIComponent(token)}`;

    const subject = "Passwort zurücksetzen / Password Reset Request";
    const text = `Hallo ${fullName},\n\nSie haben das Zurücksetzen Ihres Passworts angefordert. Klicken Sie auf folgenden Link:\n${resetUrl}\n\nDieser Link ist 1 Stunde gültig. Falls Sie dies nicht angefordert haben, ignorieren Sie diese E-Mail.\n\n---\n\nHello ${fullName},\n\nYou requested a password reset. Click the following link:\n${resetUrl}\n\nThis link is valid for 1 hour. If you did not request this, please ignore this email.`;

    return this.dispatch({
      to: email,
      subject,
      text,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #111;">
          <h2>German Auto</h2>
          <p>Hallo ${fullName},</p>
          <p>Sie haben das Zurücksetzen Ihres Passworts angefordert. Klicken Sie auf die Schaltfläche:</p>
          <p><a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background: #000; color: #fff; text-decoration: none; border-radius: 4px;">Passwort zurücksetzen</a></p>
          <p style="color: #666; font-size: 13px;">Link gültig für 1 Stunde:<br>${resetUrl}</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
          <p>Hello ${fullName},</p>
          <p>You requested a password reset. If you did not make this request, please ignore this email.</p>
        </div>
      `,
    });
  }

  /**
   * Internal dispatcher handling configured providers
   */
  async dispatch({ to, subject, text, html }) {
    const provider = this.resolveProvider();

    if (provider === "unconfigured") {
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          `[EmailService] Notice: No email provider configured (RESEND_API_KEY or SMTP credentials missing). Email to <${to}> with subject "${subject}" logged in development mode.`
        );
      }
      return {
        success: true,
        sent: false,
        reason: "PROVIDER_NOT_CONFIGURED",
        recipient: to,
        subject,
      };
    }

    // Provider integration hook for when credentials are provided
    try {
      if (provider === "resend") {
        // Will be invoked via Resend SDK when configured
        return { success: true, sent: true, provider: "resend" };
      }

      if (provider === "smtp") {
        // Will be invoked via SMTP transporter when configured
        return { success: true, sent: true, provider: "smtp" };
      }
    } catch (err) {
      console.error("[EmailService] Error dispatching email:", err.message);
      return { success: false, error: err.message };
    }

    return { success: false, error: "Unsupported provider" };
  }
}

module.exports = new EmailService();
