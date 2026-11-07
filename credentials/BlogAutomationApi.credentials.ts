import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class BlogAutomationApi implements ICredentialType {
	name = 'blogAutomationApi';

	displayName = 'Blog Automation API';

	icon: Icon = { light: 'file:../icons/blogautomation.svg', dark: 'file:../icons/blogautomation.dark.svg' };

	documentationUrl =
		'https://github.com/shsoftwaresolutioncom/n8n-nodes-blogautomation?tab=readme-ov-file#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			placeholder: 'ba_live_…',
			description:
				'Create a key in Blog Automation under "Entwickler / API" (Starter and Pro plans). Scopes: articles:read, articles:write, articles:publish, ai:generate, ideas:read, ideas:write, templates:read, sites:read, account:read, webhooks:write (webhook trigger).',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://app.blog-automation.com/api/v1/ext',
			description: 'Only change this for a test instance',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl.replace(/\\/+$/, "")}}',
			url: '/me',
			method: 'GET',
		},
	};
}
