import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  Icon,
  INodeProperties,
} from 'n8n-workflow';

export class Chat33Api implements ICredentialType {
  name = 'chat33Api';
  displayName = 'Chat33 API';
  icon: Icon = { light: 'file:../icons/chat33.png', dark: 'file:../icons/chat33.dark.png' };

  documentationUrl = 'https://chat33.io/developers';

  properties: INodeProperties[] = [
    {
      displayName: 'Base URL',
      name: 'baseUrl',
      type: 'string',
      default: 'https://chat33.io',
      description: 'Chat33 instance URL (no trailing slash)',
    },
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      description: 'Create one in Chat33 → Settings → API Keys',
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: {
        'x-api-key': '={{$credentials.apiKey}}',
      },
    },
  };

  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.baseUrl}}',
      url: '/api/v1/accounts',
    },
  };
}
