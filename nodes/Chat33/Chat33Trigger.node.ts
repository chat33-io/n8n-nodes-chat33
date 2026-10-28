import type {
  IDataObject,
  IHookFunctions,
  INodeType,
  INodeTypeDescription,
  IWebhookFunctions,
  IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { chat33ApiRequest } from './GenericFunctions';
import { TRIGGER_EVENTS, verifySignature, webhookSlot } from './TriggerHelpers';

type WebhookState = { webhook?: IDataObject | null };

export class Chat33Trigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Chat33 Trigger',
    name: 'chat33Trigger',
    icon: { light: 'file:../../icons/chat33.png', dark: 'file:../../icons/chat33.dark.png' },
    group: ['trigger'],
    version: 1,
    subtitle: '={{$parameter["events"].join(", ")}}',
    description: 'Starts the workflow when a DM arrives or a lead is captured in Chat33',
    defaults: { name: 'Chat33 Trigger' },
    inputs: [],
    outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: 'chat33Api', required: true }],
    webhooks: [
      {
        name: 'default',
        httpMethod: 'POST',
        responseMode: 'onReceived',
        path: 'webhook',
      },
    ],
    properties: [
      {
        displayName:
          'Chat33 sends events to one webhook per workspace. Activating this trigger takes that slot, so it refuses to start while another URL (a custom bot, another workflow) is saved in Chat33 → Settings → Webhooks. The API key needs the inbox:read and inbox:write scopes.',
        name: 'notice',
        type: 'notice',
        default: '',
      },
      {
        displayName: 'Events',
        name: 'events',
        type: 'multiOptions',
        required: true,
        default: ['message.received'],
        options: [
          {
            name: 'Lead Captured',
            value: 'lead.captured',
            description: 'A contact left their email or phone in a DM flow',
          },
          {
            name: 'Message Received',
            value: 'message.received',
            description: 'A new Instagram, Facebook or WhatsApp DM came in',
          },
        ],
      },
    ],
  };

  webhookMethods = {
    default: {
      async checkExists(this: IHookFunctions): Promise<boolean> {
        const ownUrl = this.getNodeWebhookUrl('default') as string;
        const res = (await chat33ApiRequest.call(this, 'GET', '/api/v1/webhooks')) as WebhookState;
        if (webhookSlot(res.webhook, ownUrl) !== 'ours') return false;
        // Re-saving with the chosen events also keeps them in step after an edit.
        const events = this.getNodeParameter('events', []) as string[];
        const saved = (await chat33ApiRequest.call(this, 'PUT', '/api/v1/webhooks', {
          url: ownUrl,
          enabled: true,
          events,
        })) as WebhookState;
        this.getWorkflowStaticData('node').secret = saved.webhook?.secret;
        return true;
      },

      async create(this: IHookFunctions): Promise<boolean> {
        const ownUrl = this.getNodeWebhookUrl('default') as string;
        const current = (await chat33ApiRequest.call(this, 'GET', '/api/v1/webhooks')) as WebhookState;
        if (webhookSlot(current.webhook, ownUrl) === 'taken') {
          throw new NodeOperationError(
            this.getNode(),
            `This Chat33 workspace already sends its webhook to ${String(current.webhook?.url)}`,
            {
              description:
                'Chat33 has one webhook per workspace. Remove that URL in Chat33 → Settings → Webhooks (or deactivate the other workflow) and activate this trigger again.',
            },
          );
        }
        const events = this.getNodeParameter('events', []) as string[];
        const saved = (await chat33ApiRequest.call(this, 'PUT', '/api/v1/webhooks', {
          url: ownUrl,
          enabled: true,
          events,
        })) as WebhookState;
        this.getWorkflowStaticData('node').secret = saved.webhook?.secret;
        return true;
      },

      async delete(this: IHookFunctions): Promise<boolean> {
        const ownUrl = this.getNodeWebhookUrl('default') as string;
        const current = (await chat33ApiRequest.call(this, 'GET', '/api/v1/webhooks')) as WebhookState;
        // Never remove a webhook this trigger does not own.
        if (webhookSlot(current.webhook, ownUrl) === 'ours') {
          await chat33ApiRequest.call(this, 'DELETE', '/api/v1/webhooks');
        }
        delete this.getWorkflowStaticData('node').secret;
        return true;
      },
    },
  };

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const req = this.getRequestObject();
    const secret = String(this.getWorkflowStaticData('node').secret || '');
    const rawBody = (req as { rawBody?: Buffer }).rawBody;
    const body = rawBody ? rawBody.toString('utf8') : JSON.stringify(req.body ?? {});
    const header = this.getHeaderData()['x-chat33-signature'] as string | undefined;

    if (!verifySignature(header, body, secret, Math.floor(Date.now() / 1000))) {
      const res = this.getResponseObject();
      res.status(401).send('Invalid signature');
      return { noWebhookResponse: true };
    }

    const payload = this.getBodyData();
    const events = this.getNodeParameter('events', []) as string[];
    const event = String(payload.event ?? '');
    if (!(TRIGGER_EVENTS as readonly string[]).includes(event) || !events.includes(event)) {
      return { webhookResponse: 'ignored' };
    }

    return { workflowData: [this.helpers.returnJsonArray(payload)] };
  }
}
