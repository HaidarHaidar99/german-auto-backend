/**
 * GERMAN AUTO — Production Email Delivery Service
 *
 * Implements transactional email delivery via the Resend REST API (native fetch)
 * with robust template localization (100% German or 100% English, zero mixed language),
 * strict 15-minute token lifetime notices, and safe test-transport fallbacks.
 *
 * Supported transactional workflows:
 *  - Account verification emails
 *  - Password reset emails
 *  - Resend verification emails
 */

class EmailService {
  constructor() {
    // In-memory test dispatch recording (for automated tests and local dev inspection)
    this.sentEmails = [];
  }

  /**
   * Determine the active delivery provider
   * @returns {"resend" | "test" | "unconfigured"}
   */
  resolveProvider() {
    if (process.env.NODE_ENV === "test" || process.env.EMAIL_PROVIDER === "test") {
      return "test";
    }
    if (process.env.RESEND_API_KEY) {
      return "resend";
    }
    return "unconfigured";
  }

  getFrontendUrl() {
    return (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");
  }

  getFromAddress() {
    return process.env.EMAIL_FROM || "German Auto <onboarding@resend.dev>";
  }

  /**
   * Normalize language code to supported 'de' or 'en'
   */
  normalizeLanguage(lang) {
    if (!lang || typeof lang !== "string") return "de";
    const cleaned = lang.trim().toLowerCase();
    if (cleaned.startsWith("en")) return "en";
    return "de";
  }

  /**
   * Build HTML email wrapper with premium German Auto styling
   */
  buildEmailLayout({ title, contentHtml, footerNote, lang = "de" }) {
    const isEn = lang === "en";
    const brandTagline = isEn
      ? "German Auto Marketplace &bull; Premium Automotive Engineering"
      : "German Auto Marktplatz &bull; Premium Automobiltechnik";
    const automatedNotice = isEn
      ? "This is an automated security notification. Please do not reply directly to this email."
      : "Dies ist eine automatische Sicherheitsbenachrichtigung. Bitte antworten Sie nicht direkt auf diese E-Mail.";

    return `<!DOCTYPE html>
<html lang="${isEn ? "en" : "de"}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0b0d11; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #e4e4e7;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #0b0d11; padding: 40px 16px;">
    <tr>
      <td align="center">
        <!-- Main Card Container -->
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 580px; background-color: #14171f; border: 1px solid #232834; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
          
          <!-- Header Bar -->
          <tr>
            <td style="padding: 28px 36px; border-bottom: 1px solid #232834; background: linear-gradient(180deg, #181c26 0%, #14171f 100%);">
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <span style="font-size: 20px; font-weight: 800; letter-spacing: 2px; color: #ffffff; text-transform: uppercase;">GERMAN<span style="color: #d97706;"> AUTO</span></span>
                  </td>
                  <td align="right">
                    <span style="font-size: 11px; letter-spacing: 1px; color: #71717a; text-transform: uppercase; font-weight: 600;">SECURITY</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 36px 36px 28px 36px;">
              ${contentHtml}
            </td>
          </tr>

          <!-- Footer Bar -->
          <tr>
            <td style="padding: 24px 36px; background-color: #0f1218; border-top: 1px solid #1f242f; text-align: center;">
              <p style="margin: 0 0 8px 0; font-size: 12px; color: #a1a1aa; font-weight: 500;">
                ${brandTagline}
              </p>
              <p style="margin: 0 0 8px 0; font-size: 11px; color: #71717a; line-height: 1.5;">
                ${automatedNotice}
              </p>
              ${
                footerNote
                  ? `<p style="margin: 8px 0 0 0; font-size: 11px; color: #52525b; line-height: 1.4;">${footerNote}</p>`
                  : ""
              }
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  /**
   * Send account verification email
   * @param {Object} params
   * @param {string} params.email - Recipient email
   * @param {string} params.fullName - Recipient display name
   * @param {string} params.token - 64-char hex verification token
   * @param {string} [params.lang="de"] - Language preference ('de' or 'en')
   */
  async sendVerificationEmail({ email, fullName, token, lang = "de" }) {
    const isEn = this.normalizeLanguage(lang) === "en";
    const frontendUrl = this.getFrontendUrl();
    const verificationUrl = `${frontendUrl}/verify?token=${encodeURIComponent(token)}`;
    const safeName = fullName ? fullName.trim() : (isEn ? "Customer" : "Kunde");

    let subject;
    let contentHtml;
    let text;
    let footerNote;

    if (isEn) {
      subject = "Verify your email address — German Auto";
      footerNote = "If you did not register for a German Auto account, you can safely ignore this email.";
      text = `Hello ${safeName},

Thank you for registering with German Auto.

Please verify your email address by opening the following link:
${verificationUrl}

IMPORTANT SECURITY NOTICE:
This verification link is valid for exactly 15 minutes.
If you did not create an account with German Auto, please ignore this message.

— German Auto Marketplace Team`;

      contentHtml = `
        <h1 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 700; color: #ffffff; letter-spacing: -0.3px;">
          Verify Your Email Address
        </h1>
        <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: #d4d4d8;">
          Hello <strong style="color: #ffffff;">${safeName}</strong>,
        </p>
        <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: #a1a1aa;">
          Thank you for registering with German Auto. Please confirm your email address to activate your account and access verified marketplace services.
        </p>
        <div style="margin: 28px 0; text-align: left;">
          <a href="${verificationUrl}" target="_blank" rel="noopener noreferrer" style="background-color: #d97706; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-size: 15px; font-weight: 600; display: inline-block; letter-spacing: 0.2px; box-shadow: 0 4px 14px rgba(217, 119, 6, 0.35);">
            Verify Email Address
          </a>
        </div>
        <div style="margin: 28px 0 0 0; padding: 16px; background-color: #1a1e27; border-left: 3px solid #d97706; border-radius: 4px;">
          <p style="margin: 0 0 6px 0; font-size: 13px; font-weight: 600; color: #f4f4f5;">
            Validity Period: Exactly 15 Minutes
          </p>
          <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #a1a1aa;">
            For security reasons, this link will expire 15 minutes after issuance. If expired, you may request a new link at any time.
          </p>
        </div>
        <div style="margin: 24px 0 0 0; border-top: 1px solid #232834; padding-top: 18px;">
          <p style="margin: 0 0 6px 0; font-size: 12px; color: #71717a;">
            Button not working? Copy and paste this URL into your browser:
          </p>
          <p style="margin: 0; font-size: 12px; word-break: break-all; color: #d97706;">
            ${verificationUrl}
          </p>
        </div>
      `;
    } else {
      // 100% German template
      subject = "Bestätigen Sie Ihre E-Mail-Adresse — German Auto";
      footerNote = "Falls Sie kein Konto bei German Auto erstellt haben, können Sie diese E-Mail bedenkenlos ignorieren.";
      text = `Hallo ${safeName},

vielen Dank für Ihre Registrierung bei German Auto.

Bitte bestätigen Sie Ihre E-Mail-Adresse über folgenden Link:
${verificationUrl}

WICHTIGER SICHERHEITSHINWEIS:
Dieser Bestätigungslink ist aus Sicherheitsgründen genau 15 Minuten lang gültig.
Falls Sie kein Konto bei German Auto angefordert haben, ignorieren Sie diese E-Mail bitte.

— Ihr German Auto Marktplatz-Team`;

      contentHtml = `
        <h1 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 700; color: #ffffff; letter-spacing: -0.3px;">
          E-Mail-Adresse bestätigen
        </h1>
        <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: #d4d4d8;">
          Hallo <strong style="color: #ffffff;">${safeName}</strong>,
        </p>
        <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: #a1a1aa;">
          vielen Dank für Ihre Registrierung bei German Auto. Bitte bestätigen Sie Ihre E-Mail-Adresse, um Ihr Benutzerkonto zu aktivieren und alle Services uneingeschränkt nutzen zu können.
        </p>
        <div style="margin: 28px 0; text-align: left;">
          <a href="${verificationUrl}" target="_blank" rel="noopener noreferrer" style="background-color: #d97706; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-size: 15px; font-weight: 600; display: inline-block; letter-spacing: 0.2px; box-shadow: 0 4px 14px rgba(217, 119, 6, 0.35);">
            E-Mail-Adresse bestätigen
          </a>
        </div>
        <div style="margin: 28px 0 0 0; padding: 16px; background-color: #1a1e27; border-left: 3px solid #d97706; border-radius: 4px;">
          <p style="margin: 0 0 6px 0; font-size: 13px; font-weight: 600; color: #f4f4f5;">
            Gültigkeitsdauer: Genau 15 Minuten
          </p>
          <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #a1a1aa;">
            Aus Sicherheitsgründen verfällt dieser Bestätigungslink 15 Minuten nach Ausstellung. Nach Ablauf können Sie jederzeit einen neuen Link anfordern.
          </p>
        </div>
        <div style="margin: 24px 0 0 0; border-top: 1px solid #232834; padding-top: 18px;">
          <p style="margin: 0 0 6px 0; font-size: 12px; color: #71717a;">
            Funktioniert die Schaltfläche nicht? Kopieren Sie folgenden Link in Ihren Browser:
          </p>
          <p style="margin: 0; font-size: 12px; word-break: break-all; color: #d97706;">
            ${verificationUrl}
          </p>
        </div>
      `;
    }

    const html = this.buildEmailLayout({
      title: subject,
      contentHtml,
      footerNote,
      lang: isEn ? "en" : "de",
    });

    return this.dispatch({
      to: email,
      subject,
      text,
      html,
      type: "VERIFICATION",
      lang: isEn ? "en" : "de",
    });
  }

  /**
   * Send password reset email
   * @param {Object} params
   * @param {string} params.email - Recipient email
   * @param {string} params.fullName - Recipient display name
   * @param {string} params.token - 64-char hex reset token
   * @param {string} [params.lang="de"] - Language preference ('de' or 'en')
   */
  async sendPasswordResetEmail({ email, fullName, token, lang = "de" }) {
    const isEn = this.normalizeLanguage(lang) === "en";
    const frontendUrl = this.getFrontendUrl();
    const resetUrl = `${frontendUrl}/reset-password?token=${encodeURIComponent(token)}`;
    const safeName = fullName ? fullName.trim() : (isEn ? "Customer" : "Kunde");

    let subject;
    let contentHtml;
    let text;
    let footerNote;

    if (isEn) {
      subject = "Reset your password — German Auto";
      footerNote = "If you did not request a password reset, please ignore this email. Your password remains securely protected.";
      text = `Hello ${safeName},

You recently requested to reset your password for your German Auto account.

Click the following link to choose a new password:
${resetUrl}

IMPORTANT SECURITY NOTICE:
This password reset link is valid for exactly 15 minutes and can only be used once.
If you did not request this change, your account is safe and no action is required.

— German Auto Marketplace Team`;

      contentHtml = `
        <h1 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 700; color: #ffffff; letter-spacing: -0.3px;">
          Reset Your Password
        </h1>
        <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: #d4d4d8;">
          Hello <strong style="color: #ffffff;">${safeName}</strong>,
        </p>
        <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: #a1a1aa;">
          We received a request to reset the password for your German Auto account. Click the button below to establish a new password.
        </p>
        <div style="margin: 28px 0; text-align: left;">
          <a href="${resetUrl}" target="_blank" rel="noopener noreferrer" style="background-color: #d97706; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-size: 15px; font-weight: 600; display: inline-block; letter-spacing: 0.2px; box-shadow: 0 4px 14px rgba(217, 119, 6, 0.35);">
            Reset Password
          </a>
        </div>
        <div style="margin: 28px 0 0 0; padding: 16px; background-color: #1a1e27; border-left: 3px solid #d97706; border-radius: 4px;">
          <p style="margin: 0 0 6px 0; font-size: 13px; font-weight: 600; color: #f4f4f5;">
            Single-Use Link &bull; Valid for Exactly 15 Minutes
          </p>
          <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #a1a1aa;">
            For your security, this password reset link will expire in 15 minutes and can only be used a single time. Once used or expired, all active sessions are preserved unless a new password is submitted.
          </p>
        </div>
        <div style="margin: 24px 0 0 0; border-top: 1px solid #232834; padding-top: 18px;">
          <p style="margin: 0 0 6px 0; font-size: 12px; color: #71717a;">
            Button not working? Copy and paste this URL into your browser:
          </p>
          <p style="margin: 0; font-size: 12px; word-break: break-all; color: #d97706;">
            ${resetUrl}
          </p>
        </div>
      `;
    } else {
      // 100% German template
      subject = "Passwort zurücksetzen — German Auto";
      footerNote = "Falls Sie kein Zurücksetzen angefordert haben, können Sie diese E-Mail ignorieren. Ihr Passwort bleibt unverändert geschützt.";
      text = `Hallo ${safeName},

Sie haben eine Anfrage zum Zurücksetzen Ihres Passworts für Ihr German Auto Benutzerkonto gestellt.

Klicken Sie auf folgenden Link, um ein neues Passwort festzulegen:
${resetUrl}

WICHTIGER SICHERHEITSHINWEIS:
Dieser Link ist aus Sicherheitsgründen genau 15 Minuten gültig und kann nur einmal verwendet werden.
Falls Sie diese Anfrage nicht gestellt haben, bleibt Ihr Passwort unverändert.

— Ihr German Auto Marktplatz-Team`;

      contentHtml = `
        <h1 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 700; color: #ffffff; letter-spacing: -0.3px;">
          Passwort zurücksetzen
        </h1>
        <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: #d4d4d8;">
          Hallo <strong style="color: #ffffff;">${safeName}</strong>,
        </p>
        <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: #a1a1aa;">
          Sie haben das Zurücksetzen Ihres Passworts bei German Auto angefordert. Klicken Sie auf die nachfolgende Schaltfläche, um Ihr neues Kennwort einzurichten.
        </p>
        <div style="margin: 28px 0; text-align: left;">
          <a href="${resetUrl}" target="_blank" rel="noopener noreferrer" style="background-color: #d97706; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-size: 15px; font-weight: 600; display: inline-block; letter-spacing: 0.2px; box-shadow: 0 4px 14px rgba(217, 119, 6, 0.35);">
            Passwort zurücksetzen
          </a>
        </div>
        <div style="margin: 28px 0 0 0; padding: 16px; background-color: #1a1e27; border-left: 3px solid #d97706; border-radius: 4px;">
          <p style="margin: 0 0 6px 0; font-size: 13px; font-weight: 600; color: #f4f4f5;">
            Einmaliger Link &bull; Gültig für genau 15 Minuten
          </p>
          <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #a1a1aa;">
            Dieser Link verfällt aus Sicherheitsgründen nach 15 Minuten und kann nur genau einmal verwendet werden. Falls Sie kein Zurücksetzen angefordert haben, ist keine weitere Aktion erforderlich.
          </p>
        </div>
        <div style="margin: 24px 0 0 0; border-top: 1px solid #232834; padding-top: 18px;">
          <p style="margin: 0 0 6px 0; font-size: 12px; color: #71717a;">
            Funktioniert die Schaltfläche nicht? Kopieren Sie folgenden Link in Ihren Browser:
          </p>
          <p style="margin: 0; font-size: 12px; word-break: break-all; color: #d97706;">
            ${resetUrl}
          </p>
        </div>
      `;
    }

    const html = this.buildEmailLayout({
      title: subject,
      contentHtml,
      footerNote,
      lang: isEn ? "en" : "de",
    });

    return this.dispatch({
      to: email,
      subject,
      text,
      html,
      type: "PASSWORD_RESET",
      lang: isEn ? "en" : "de",
    });
  }

  /**
   * Internal dispatcher handling configured providers
   */
  async dispatch({ to, subject, text, html, type = "SYSTEM", lang = "de" }) {
    const provider = this.resolveProvider();

    // Record email in test/mock memory log
    const emailRecord = {
      to,
      subject,
      text,
      html,
      type,
      lang,
      timestamp: new Date().toISOString(),
    };
    this.sentEmails.push(emailRecord);

    // ── 1. REAL RESEND PRODUCTION PROVIDER ─────────────────────────────────────
    if (provider === "resend") {
      const apiKey = process.env.RESEND_API_KEY;
      const from = this.getFromAddress();

      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from,
            to: [to],
            subject,
            html,
            text,
          }),
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          const errMessage = data?.message || `HTTP ${response.status} ${response.statusText}`;
          console.error(`[EmailService] Resend API error: ${errMessage}`);
          return {
            success: false,
            sent: false,
            provider: "resend",
            error: errMessage,
          };
        }

        return {
          success: true,
          sent: true,
          provider: "resend",
          id: data.id,
          recipient: to,
          subject,
        };
      } catch (err) {
        console.error(`[EmailService] Network/dispatch error to Resend: ${err.message}`);
        return {
          success: false,
          sent: false,
          provider: "resend",
          error: err.message,
        };
      }
    }

    // ── 2. UNCONFIGURED PRODUCTION WARNING ────────────────────────────────────
    if (process.env.NODE_ENV === "production") {
      console.error(
        `[EmailService] CRITICAL: Email to <${to}> could not be delivered. RESEND_API_KEY is not configured in production environment.`
      );
      return {
        success: false,
        sent: false,
        provider: "unconfigured",
        error: "EMAIL_PROVIDER_NOT_CONFIGURED",
        recipient: to,
        subject,
      };
    }

    // ── 3. TEST / DEV SAFE SIMULATED TRANSPORT ────────────────────────────────
    if (process.env.NODE_ENV !== "test") {
      console.log(
        `[EmailService:Dev] Simulated dispatch via test transport to <${to}> [${lang.toUpperCase()}]: "${subject}"`
      );
    }

    return {
      success: true,
      sent: false,
      provider: "test-transport",
      reason: "TEST_MODE_OR_UNCONFIGURED_DEV",
      recipient: to,
      subject,
      mockId: `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    };
  }

  /**
   * Helper methods for tests
   */
  getSentEmails() {
    return [...this.sentEmails];
  }

  clearSentEmails() {
    this.sentEmails = [];
  }

  getLastEmail() {
    return this.sentEmails[this.sentEmails.length - 1] || null;
  }
}

module.exports = new EmailService();
