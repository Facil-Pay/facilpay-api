import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Job } from 'bullmq';
import { AppLogger } from '../logger/logger.service';
import { Logger } from 'pino';
import { EmailService } from './email.service';
import { EmailEventType } from './email-log.entity';

export interface SendEmailJobData {
  to: string;
  subject: string;
  templateName: string;
  templateData: Record<string, any>;
  eventType: EmailEventType;
  recipientRole: string;
  paymentId?: string;
  refundId?: string;
  includeUnsubscribe?: boolean;
}

@Processor('emails')
@Injectable()
export class EmailProcessor extends WorkerHost {
  private readonly logger: Logger;

  constructor(
    private readonly emailService: EmailService,
    appLogger: AppLogger,
  ) {
    super();
    this.logger = appLogger.child({ module: EmailProcessor.name });
  }

  async process(job: Job<SendEmailJobData>): Promise<any> {
    const data = job.data;

    this.logger.info(
      { jobId: job.id, eventType: data.eventType, to: data.to },
      'Processing email job',
    );

    await this.emailService.sendEmail(data);

    return { success: true };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(
      { jobId: job.id, attempt: job.attemptsMade, error: error.message },
      'Email job failed',
    );
  }
}
