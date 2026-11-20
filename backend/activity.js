import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DeleteMessageCommand, ReceiveMessageCommand, SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

// Activity feed, to show asynchronous messaging:
//   API request -> SQS queue -> worker (runs inside every API server) -> DynamoDB table -> GET /api/activity
// A message the worker cannot store is retried by SQS; after 3 failed attempts SQS moves it to the dead-letter queue.
const region = process.env.AWS_REGION || 'us-east-1';
const queueUrl = process.env.ACTIVITY_QUEUE_URL;
const table = process.env.ACTIVITY_TABLE;
const instanceId = process.env.INSTANCE_ID || 'local';
const partition = 'activity'; // every event shares one partition, sorted by time: fine for a demo-sized feed
const keepSeconds = 7 * 24 * 60 * 60; // DynamoDB's TTL deletes events after a week

export const activityEnabled = Boolean(queueUrl && table);
const sqs = activityEnabled ? new SQSClient({ region }) : null;
const db = activityEnabled ? DynamoDBDocumentClient.from(new DynamoDBClient({ region })) : null;

// Called after a change is saved in PostgreSQL. It never fails the user's request: the feed is a side channel.
export async function recordActivity(action, item) {
  if (!activityEnabled) return;
  const event = { action, itemId: item.id, itemName: item.name, at: new Date().toISOString(), queuedBy: instanceId };
  try {
    await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(event) }));
  } catch (error) {
    console.error(`Could not queue activity event: ${error.message}`);
  }
}

async function storeMessage(message) {
  const event = JSON.parse(message.Body);
  if (typeof event.action !== 'string' || typeof event.at !== 'string' || typeof event.itemName !== 'string') {
    throw new Error('not an activity event');
  }
  await db.send(new PutCommand({
    TableName: table,
    Item: {
      pk: partition,
      sk: `${event.at}#${message.MessageId}`,
      action: event.action,
      itemId: String(event.itemId),
      itemName: event.itemName,
      at: event.at,
      queuedBy: String(event.queuedBy),
      savedBy: instanceId,
      expiresAt: Math.floor(Date.now() / 1000) + keepSeconds,
    },
  }));
  // Only delete after DynamoDB accepted the write; otherwise the message becomes visible again and is retried.
  await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle }));
}

// Long-polls the queue (up to 20 s per call, so an idle queue costs almost nothing). Returns a stop function.
export function startActivityWorker() {
  if (!activityEnabled) return () => {};
  const controller = new AbortController();
  (async () => {
    while (!controller.signal.aborted) {
      try {
        const { Messages = [] } = await sqs.send(
          new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 20 }),
          { abortSignal: controller.signal },
        );
        for (const message of Messages) {
          await storeMessage(message).catch((error) => console.error(`Activity message ${message.MessageId} not stored: ${error.message}`));
        }
      } catch (error) {
        if (controller.signal.aborted) break;
        console.error(`Activity worker: ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  })();
  console.log(`Activity worker polling ${queueUrl}`);
  return () => controller.abort();
}

export async function listActivity(limit = 12) {
  const { Items = [] } = await db.send(new QueryCommand({
    TableName: table,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: { ':pk': partition },
    ScanIndexForward: false,
    Limit: limit,
  }));
  return Items.map(({ sk, action, itemName, at, queuedBy, savedBy }) => ({ id: sk, action, itemName, at, queuedBy, savedBy }));
}
