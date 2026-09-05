/**
 * OtpProvider port.
 *
 * The provider only DELIVERS a code. It never generates, stores or verifies
 * one — that is the auth module's job, so swapping SMS vendors can never
 * change the security properties of the login flow.
 */

export interface SendOtpInput {
  /** Canonical 10-digit Indian mobile, no country code. */
  mobile: string;
  code: string;
  /** Minutes until the code expires, for the message text. */
  expiresInMinutes: number;
}

export interface SendOtpResult {
  /** Provider's message id, for delivery-failure investigation. */
  messageId: string | null;
  /**
   * Present ONLY for the console provider in non-production environments so
   * local and automated testing can complete a login without an SMS gateway.
   * The real provider always returns null.
   */
  devCode?: string;
}

export interface OtpProvider {
  readonly name: string;
  send(input: SendOtpInput): Promise<SendOtpResult>;
}
