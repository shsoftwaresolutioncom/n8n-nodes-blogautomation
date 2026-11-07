import type { INodeProperties } from 'n8n-workflow';

const show = (operation: string[]) => ({ show: { resource: ['article'], operation } });
const LOAD = 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>';

export const siteField = (displayOptions: INodeProperties['displayOptions'], description = LOAD): INodeProperties => ({
	displayName: 'Site Name or ID',
	name: 'siteId',
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getSites' },
	default: '',
	description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	...(description !== LOAD ? { description } : {}),
	...(displayOptions ? { displayOptions } : {}),
});

/** Optional article fields (server/routes/ext.js → ARTICLE_FIELDS). */
const articleFields: INodeProperties[] = [
	{ displayName: 'Categories', name: 'categories', type: 'string', default: '', description: 'Comma-separated WordPress category names' },
	{ displayName: 'Content', name: 'content', type: 'string', typeOptions: { rows: 6 }, default: '', description: 'HTML – sanitised like in the editor' },
	{ displayName: 'Excerpt', name: 'excerpt', type: 'string', typeOptions: { rows: 2 }, default: '' },
	{ displayName: 'Focus Keyword', name: 'focusKeyword', type: 'string', default: '' },
	{ displayName: 'Keywords', name: 'keywords', type: 'string', default: '', description: 'Comma-separated list' },
	{ displayName: 'Language', name: 'language', type: 'string', default: '', placeholder: 'en', description: 'Two-letter code, e.g. en or de' },
	{ displayName: 'Meta Description', name: 'metaDescription', type: 'string', default: '' },
	{ displayName: 'SEO Title', name: 'seoTitle', type: 'string', default: '' },
	{ ...siteField(undefined), displayName: 'Site Name or ID' },
	{ displayName: 'Slug', name: 'slug', type: 'string', default: '' },
	{ displayName: 'Tags', name: 'tags', type: 'string', default: '', description: 'Comma-separated list' },
	{ displayName: 'Template Name or ID', name: 'templateId', type: 'options', typeOptions: { loadOptionsMethod: 'getTemplates' }, default: '', description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>' },
];

export const articleProperties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['article'] } },
		options: [
			{ name: 'Add to Calendar', value: 'addToCalendar', action: 'Add an article to the calendar', description: 'Schedule an article at a time or in the next free slot (approves a draft in the same step)' },
			{ name: 'Create', value: 'create', action: 'Create an article', description: 'Create an article with your own text (draft or review)' },
			{ name: 'Get', value: 'get', action: 'Get an article', description: 'Get one article with HTML content and SEO fields' },
			{ name: 'Get Many', value: 'getAll', action: 'Get many articles', description: 'List and filter articles, newest first' },
			{ name: 'Get Status', value: 'getStatus', action: 'Get the publishing status of an article', description: 'Status, schedule, WordPress link, last error and publishing job' },
			{ name: 'Publish', value: 'publish', action: 'Publish an article', description: 'Publish an approved article to its website right away' },
			{ name: 'Unschedule', value: 'unschedule', action: 'Unschedule an article', description: 'Remove an article from the calendar (back to approved)' },
			{ name: 'Update', value: 'update', action: 'Update an article', description: 'Change only the given fields of an article' },
			{ name: 'Write with AI', value: 'generate', action: 'Write an article with AI', description: 'Let Blog Automation write a full article (uses tokens)' },
		],
		default: 'generate',
	},
	{
		displayName: 'Article ID',
		name: 'articleId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: show(['get', 'getStatus', 'update', 'publish', 'addToCalendar', 'unschedule']),
	},

	// ----- create -----
	{ displayName: 'Title', name: 'title', type: 'string', required: true, default: '', displayOptions: show(['create']) },
	{
		displayName: 'Status',
		name: 'status',
		type: 'options',
		options: [
			{ name: 'Draft', value: 'draft' },
			{ name: 'Review', value: 'review' },
		],
		default: 'draft',
		displayOptions: show(['create']),
	},
	{ displayName: 'Additional Fields', name: 'additionalFields', type: 'collection', placeholder: 'Add Field', default: {}, displayOptions: show(['create']), options: articleFields },

	// ----- update -----
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: show(['update']),
		options: [
			...articleFields,
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: [
					{ name: 'Approved', value: 'approved' },
					{ name: 'Draft', value: 'draft' },
					{ name: 'Review', value: 'review' },
				],
				default: 'review',
				description: 'Approved needs the scope articles:publish',
			},
			{ displayName: 'Title', name: 'title', type: 'string', default: '' },
		],
	},

	// ----- write with AI -----
	{
		displayName: 'Topic',
		name: 'topic',
		type: 'string',
		default: '',
		placeholder: 'Spring garden checklist',
		description: 'What the article is about. Leave empty when you give an idea ID or a keyword.',
		displayOptions: show(['generate']),
	},
	{
		displayName: 'Wait for Completion',
		name: 'waitForCompletion',
		type: 'boolean',
		default: true,
		description: 'Whether to wait until the article is written (can take several minutes) and return it. Off: return the running job at once; get it later with Job → Get or the trigger event "Article Ready".',
		displayOptions: show(['generate']),
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: show(['generate']),
		options: [
			{ displayName: 'Audience', name: 'audience', type: 'string', default: '' },
			{ displayName: 'Idea ID', name: 'ideaId', type: 'number', default: 0, description: 'Write from an idea of the idea board (needs the scope ideas:write)' },
			{ displayName: 'Keyword', name: 'keyword', type: 'string', default: '' },
			{ displayName: 'Language', name: 'language', type: 'string', default: '', placeholder: 'en' },
			{
				displayName: 'Length',
				name: 'length',
				type: 'options',
				options: [
					{ name: 'Short', value: 'short' },
					{ name: 'Medium', value: 'medium' },
					{ name: 'Long', value: 'long' },
				],
				default: 'medium',
			},
			{ displayName: 'Notes', name: 'notes', type: 'string', typeOptions: { rows: 3 }, default: '', description: 'Extra instructions for the AI' },
			{ displayName: 'Outline', name: 'outline', type: 'string', typeOptions: { rows: 3 }, default: '', description: 'Headings the article should follow, one per line' },
			{ ...siteField(undefined) },
			{ displayName: 'Template Name or ID', name: 'templateId', type: 'options', typeOptions: { loadOptionsMethod: 'getTemplates' }, default: '', description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>' },
			{ displayName: 'Tone', name: 'tone', type: 'string', default: '', placeholder: 'friendly' },
			{ displayName: 'With Image', name: 'withImage', type: 'boolean', default: false, description: 'Whether to create a featured image as well (more tokens)' },
		],
	},

	// ----- publish / add to calendar -----
	siteField(show(['publish']), 'Leave empty to use the article\'s website. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.'),
	{
		displayName: 'When',
		name: 'when',
		type: 'options',
		options: [
			{ name: 'Next Free Slot', value: 'next', description: 'The site\'s next free publishing time (its automation times or 09:00 / 17:00)' },
			{ name: 'At a Time', value: 'at' },
		],
		default: 'next',
		displayOptions: show(['addToCalendar']),
	},
	{
		displayName: 'Date and Time',
		name: 'at',
		type: 'dateTime',
		required: true,
		default: '',
		displayOptions: { show: { resource: ['article'], operation: ['addToCalendar'], when: ['at'] } },
	},
	siteField(show(['addToCalendar']), 'Leave empty to use the article\'s website. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.'),

	// ----- get many -----
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: show(['getAll']),
		options: [
			{ displayName: 'Include Content', name: 'includeContent', type: 'boolean', default: false, description: 'Whether to include the HTML content' },
			{ displayName: 'Search Title', name: 'q', type: 'string', default: '' },
			{ ...siteField(undefined) },
			{
				displayName: 'Status',
				name: 'status',
				type: 'multiOptions',
				options: [
					{ name: 'Approved', value: 'approved' },
					{ name: 'Archived', value: 'archived' },
					{ name: 'Draft', value: 'draft' },
					{ name: 'Failed', value: 'failed' },
					{ name: 'Idea', value: 'idea' },
					{ name: 'Published', value: 'published' },
					{ name: 'Publishing', value: 'publishing' },
					{ name: 'Review', value: 'review' },
					{ name: 'Scheduled', value: 'scheduled' },
				],
				default: [],
			},
			{ displayName: 'Updated Since', name: 'updatedSince', type: 'dateTime', default: '' },
		],
	},
];
