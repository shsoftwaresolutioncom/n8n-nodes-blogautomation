import type { INodeProperties } from 'n8n-workflow';
import { siteField } from './ArticleDescription';

const show = (operation: string[]) => ({ show: { resource: ['idea'], operation } });

const ideaFields: INodeProperties[] = [
	{ displayName: 'Audience', name: 'audience', type: 'string', default: '' },
	{ displayName: 'Keyword', name: 'keyword', type: 'string', default: '' },
	{ displayName: 'Language', name: 'language', type: 'string', default: '', placeholder: 'en' },
	{ displayName: 'Notes', name: 'notes', type: 'string', typeOptions: { rows: 3 }, default: '' },
	{
		displayName: 'Priority',
		name: 'priority',
		type: 'options',
		options: [
			{ name: 'High', value: 1 },
			{ name: 'Normal', value: 2 },
			{ name: 'Low', value: 3 },
		],
		default: 2,
	},
	{ ...siteField(undefined) },
];
const STATUS: INodeProperties = {
	displayName: 'Status',
	name: 'status',
	type: 'options',
	options: [
		{ name: 'Discarded', value: 'discarded' },
		{ name: 'New', value: 'new' },
		{ name: 'Planned', value: 'planned' },
		{ name: 'Used', value: 'used' },
	],
	default: 'new',
};

export const ideaProperties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['idea'] } },
		options: [
			{ name: 'Create', value: 'create', action: 'Create an idea', description: 'Add an idea to the idea board' },
			{ name: 'Delete', value: 'delete', action: 'Delete an idea', description: 'Move an idea to the bin' },
			{ name: 'Find with AI', value: 'generate', action: 'Find ideas with AI', description: 'Let the AI suggest topic ideas for a keyword (uses tokens)' },
			{ name: 'Get', value: 'get', action: 'Get an idea' },
			{ name: 'Get Many', value: 'getAll', action: 'Get many ideas', description: 'List ideas, newest first' },
			{ name: 'Update', value: 'update', action: 'Update an idea', description: 'Change only the given fields of an idea' },
		],
		default: 'create',
	},
	{ displayName: 'Idea ID', name: 'ideaId', type: 'string', required: true, default: '', displayOptions: show(['get', 'update', 'delete']) },
	{ displayName: 'Title', name: 'title', type: 'string', required: true, default: '', displayOptions: show(['create']) },
	{ displayName: 'Additional Fields', name: 'additionalFields', type: 'collection', placeholder: 'Add Field', default: {}, displayOptions: show(['create']), options: ideaFields },
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: show(['update']),
		options: [...ideaFields, STATUS, { displayName: 'Title', name: 'title', type: 'string', default: '' }],
	},
	{ displayName: 'Keyword', name: 'keyword', type: 'string', required: true, default: '', displayOptions: show(['generate']) },
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: show(['generate']),
		options: [
			{ displayName: 'Audience', name: 'audience', type: 'string', default: '' },
			{ displayName: 'Count', name: 'count', type: 'number', typeOptions: { minValue: 1, maxValue: 20 }, default: 5, description: 'How many ideas (1–20)' },
			{ displayName: 'Language', name: 'language', type: 'string', default: '', placeholder: 'en' },
			{ ...siteField(undefined) },
		],
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: show(['getAll']),
		options: [{ ...siteField(undefined) }, { ...STATUS, default: 'new' }, { displayName: 'Updated Since', name: 'updatedSince', type: 'dateTime', default: '' }],
	},
];
