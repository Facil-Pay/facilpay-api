export interface SmsProvider {
  /**
   * Send an SMS message
   * @param to - Phone number in E.164 format (e.g., +1234567890)
   * @param body - Message content
   * @returns Message ID from the provider
   */
  sendSms(to: string, body: string): Promise<string>;

  /**
   * Send an OTP verification code
   * @param to - Phone number in E.164 format
   * @param code - Verification code
   * @returns Message ID from the provider
   */
  sendVerificationCode(to: string, code: string): Promise<string>;
}
