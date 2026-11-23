import { STSClient } from '@aws-sdk/client-sts';
import { SQSClient } from '@aws-sdk/client-sqs';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { AwsDestinationService, validateDestination } from './aws-destination.service';
import { WebhookEndpoint } from './entities/webhook-endpoint.entity';

jest.mock('@aws-sdk/client-sts', () => ({ ...jest.requireActual('@aws-sdk/client-sts'), STSClient: jest.fn() }));
jest.mock('@aws-sdk/client-sqs', () => ({ ...jest.requireActual('@aws-sdk/client-sqs'), SQSClient: jest.fn() }));
jest.mock('@aws-sdk/client-eventbridge', () => ({ ...jest.requireActual('@aws-sdk/client-eventbridge'), EventBridgeClient: jest.fn() }));

describe('AWS event destinations', () => {
  const endpoint = { destinationType: 'sqs', destinationArn: 'arn:aws:sqs:eu-west-1:123456789012:events.fifo',
    roleArn: 'arn:aws:iam::123456789012:role/facilpay', merchantId: 'merchant' } as WebhookEndpoint;
  const sts = { send: jest.fn(), destroy: jest.fn() };
  const sqs = { send: jest.fn(), destroy: jest.fn() };
  const bridge = { send: jest.fn(), destroy: jest.fn() };
  beforeEach(() => {
    jest.clearAllMocks();
    (STSClient as unknown as jest.Mock).mockImplementation(() => sts);
    (SQSClient as unknown as jest.Mock).mockImplementation(() => sqs);
    (EventBridgeClient as unknown as jest.Mock).mockImplementation(() => bridge);
    sts.send.mockResolvedValue({ Credentials: { AccessKeyId: 'key', SecretAccessKey: 'secret', SessionToken: 'token' } });
    sqs.send.mockResolvedValue({ $metadata: { httpStatusCode: 200 }, MessageId: 'message' });
  });
  it('assumes the merchant role with ExternalId and delivers FIFO messages with stable deduplication', async () => {
    const service = new AwsDestinationService();
    const payload = { event: 'payment.completed', data: { id: 'payment' }, version: '2026-10-01' };
    await service.deliver(endpoint, payload, 'delivery');
    await service.deliver(endpoint, payload, 'delivery');
    expect(sts.send.mock.calls[0][0].input).toMatchObject({ RoleArn: endpoint.roleArn, ExternalId: 'merchant' });
    const first = sqs.send.mock.calls[0][0].input;
    expect(first.MessageBody).toBe(JSON.stringify(payload));
    expect(first.QueueUrl).toBe('https://sqs.eu-west-1.amazonaws.com/123456789012/events.fifo');
    expect(first.MessageDeduplicationId).toBe(sqs.send.mock.calls[1][0].input.MessageDeduplicationId);
    expect(sqs.destroy).toHaveBeenCalled();
  });
  it('treats per-entry EventBridge errors as delivery failures even on HTTP 200', async () => {
    bridge.send.mockResolvedValue({ $metadata: { httpStatusCode: 200 }, FailedEntryCount: 1, Entries: [{ ErrorCode: 'AccessDeniedException' }] });
    await expect(new AwsDestinationService().deliver({ ...endpoint, destinationType: 'eventbridge',
      destinationArn: 'arn:aws:events:eu-west-1:123456789012:event-bus/merchant' }, {}, 'delivery')).rejects.toThrow('AccessDeniedException');
    expect(bridge.destroy).toHaveBeenCalled();
  });
  it('sends the versioned payload as EventBridge Detail', async () => {
    bridge.send.mockResolvedValue({ $metadata: { httpStatusCode: 200 }, FailedEntryCount: 0, Entries: [{ EventId: 'aws-event' }] });
    const payload = { event: 'payment.completed', version: '2026-10-01', data: { id: 'payment' } };
    const result = await new AwsDestinationService().deliver({ ...endpoint, destinationType: 'eventbridge',
      destinationArn: 'arn:aws:events:eu-west-1:123456789012:event-bus/merchant' }, payload, 'delivery');
    expect(result.data).toEqual({ eventId: 'aws-event' });
    expect(bridge.send.mock.calls[0][0].input.Entries[0]).toMatchObject({ Source: 'com.facilpay', DetailType: payload.event, Detail: JSON.stringify(payload) });
  });
  it('rejects mismatched role accounts and arbitrary delivery URLs', () => {
    expect(() => validateDestination({ ...endpoint, roleArn: 'arn:aws:iam::999999999999:role/test' })).toThrow();
    expect(() => validateDestination({ ...endpoint, destinationArn: 'https://internal-host/queue' })).toThrow();
  });
  it('propagates assume-role failures to the shared retry pipeline', async () => {
    sts.send.mockRejectedValueOnce(new Error('Access denied'));
    await expect(new AwsDestinationService().deliver(endpoint, {}, 'delivery')).rejects.toThrow('Access denied');
    expect(sts.destroy).toHaveBeenCalled();
  });
});
