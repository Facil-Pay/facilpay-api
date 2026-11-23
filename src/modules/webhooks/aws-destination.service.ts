import { BadRequestException, Injectable } from '@nestjs/common';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { createHash } from 'crypto';
import { WebhookEndpoint } from './entities/webhook-endpoint.entity';

export function validateDestination(endpoint: Partial<WebhookEndpoint>): void {
  const type = endpoint.destinationType ?? 'http';
  if (type === 'http') {
    if (!endpoint.url || !/^https:\/\//i.test(endpoint.url)) throw new BadRequestException('HTTP destinations require an HTTPS URL');
    if (endpoint.destinationArn || endpoint.roleArn) throw new BadRequestException('AWS settings require an AWS destination type');
    return;
  }
  if (type !== 'sqs' && type !== 'eventbridge') throw new BadRequestException('Unknown destination type');
  const arn = /^arn:aws:(sqs|events):([a-z]{2}(?:-[a-z]+)+-\d):([0-9]{12}):(.+)$/.exec(endpoint.destinationArn ?? '');
  const role = /^arn:aws:iam::([0-9]{12}):role\/[\w+=,.@/\-]+$/.exec(endpoint.roleArn ?? '');
  if (!arn || !role || arn[3] !== role[1] || arn[1] !== (type === 'sqs' ? 'sqs' : 'events') ||
      !(type === 'sqs' ? /^[\w-]+(?:\.fifo)?$/.test(arn[4]) : /^event-bus\/[\w.\-/]+$/.test(arn[4]))) {
    throw new BadRequestException('A valid destination ARN and IAM role in the same AWS account are required');
  }
  if (endpoint.headers && Object.keys(endpoint.headers).length) throw new BadRequestException('Custom headers are only supported for HTTP destinations');
}

@Injectable()
export class AwsDestinationService {
  async deliver(endpoint: WebhookEndpoint, payload: Record<string, any>, deliveryId: string) {
    validateDestination(endpoint);
    const [, , service, region, account, resource] = endpoint.destinationArn!.split(':');
    const sts = new STSClient({ region, maxAttempts: 1, requestHandler: { requestTimeout: 10_000 } });
    try {
      const assumed = await sts.send(new AssumeRoleCommand({
        RoleArn: endpoint.roleArn!, RoleSessionName: 'facilpay-events',
        ExternalId: endpoint.merchantId, DurationSeconds: 900,
      }));
      const c = assumed.Credentials;
      if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken) throw new Error('AWS role did not return credentials');
      const options = { region, credentials: { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken }, maxAttempts: 1, requestHandler: { requestTimeout: 10_000 } };
      if (service === 'sqs') {
        const client = new SQSClient(options);
        try {
          const result = await client.send(new SendMessageCommand({
            QueueUrl: `https://sqs.${region}.amazonaws.com/${account}/${resource}`,
            MessageBody: JSON.stringify(payload),
            ...(resource.endsWith('.fifo') ? { MessageGroupId: endpoint.merchantId,
              MessageDeduplicationId: createHash('sha256').update(deliveryId).digest('hex') } : {}),
          }));
          return { status: result.$metadata.httpStatusCode ?? 200, data: { messageId: result.MessageId } };
        } finally { client.destroy(); }
      }
      const client = new EventBridgeClient(options);
      try {
        const result = await client.send(new PutEventsCommand({ Entries: [{
          EventBusName: endpoint.destinationArn!, Source: 'com.facilpay',
          DetailType: payload.event || 'webhook', Detail: JSON.stringify(payload),
        }] }));
        // EventBridge can return HTTP 200 with per-entry failures.
        if (result.FailedEntryCount || !result.Entries?.[0]?.EventId) {
          throw new Error(`EventBridge delivery failed: ${result.Entries?.[0]?.ErrorCode ?? 'missing event ID'}`);
        }
        return { status: result.$metadata.httpStatusCode ?? 200, data: { eventId: result.Entries[0].EventId } };
      } finally { client.destroy(); }
    } finally { sts.destroy(); }
  }
}
