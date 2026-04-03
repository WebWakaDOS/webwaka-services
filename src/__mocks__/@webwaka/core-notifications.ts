/**
 * Local mock of @webwaka/core/notifications for vitest testing.
 */

export interface NotificationPayload {
  tenantId: string;
  userId: string;
  type: 'email' | 'sms' | 'push';
  recipient: string;
  subject?: string;
  body: string;
}

export interface NotificationConfig {
  yournotifyApiKey?: string;
  termiiApiKey?: string;
  termiiSenderId?: string;
}

export class NotificationService {
  constructor(_config: NotificationConfig) {}

  async dispatch(_payload: NotificationPayload): Promise<boolean> {
    return true;
  }
}
