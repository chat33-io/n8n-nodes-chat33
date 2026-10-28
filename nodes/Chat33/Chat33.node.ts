import type {
  IExecuteFunctions,
  ILoadOptionsFunctions,
  INodeExecutionData,
  INodePropertyOptions,
  INodeType,
  INodeTypeDescription,
  IDataObject,
  JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError, sleep } from 'n8n-workflow';
import { collectConversations, conversationQuery } from './ConversationHelpers';
import { chat33ApiRequest, chat33UploadBuffer, listItems } from './GenericFunctions';
import {
  buildCreatePostBody,
  INVALID_PLATFORM_CONFIG_MESSAGE,
  parsePlatformConfigJson,
  waitForPostsDelivery,
} from './PostCreateHelpers';

export class Chat33 implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Chat33',
    name: 'chat33',
    icon: { light: 'file:../../icons/chat33.png', dark: 'file:../../icons/chat33.dark.png' },
    group: ['output'],
    version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description: 'Schedule and publish social posts via Chat33',
    defaults: { name: 'Chat33' },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    usableAsTool: true,
    credentials: [{ name: 'chat33Api', required: true }],
    properties: [
      {
        displayName: 'Resource',
        name: 'resource',
        type: 'options',
        noDataExpression: true,
        options: [
          { name: 'Account', value: 'account' },
          { name: 'Conversation', value: 'conversation' },
          { name: 'Media', value: 'media' },
          { name: 'Post', value: 'post' },
        ],
        default: 'post',
      },
      // ── Conversation ──
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['conversation'] } },
        options: [
          {
            name: 'Get',
            value: 'get',
            action: 'Get a conversation',
            description: 'Get one DM conversation with its contact',
          },
          {
            name: 'Get Many',
            value: 'getMany',
            action: 'List conversations',
            description: 'List Instagram, Facebook and WhatsApp DM conversations, newest first',
          },
          {
            name: 'Get Messages',
            value: 'getMessages',
            action: 'Get messages of a conversation',
            description: 'Read the messages of a conversation, oldest first',
          },
          {
            name: 'Reply',
            value: 'reply',
            action: 'Reply to a conversation',
            description: 'Send a DM from the connected account',
          },
        ],
        default: 'getMany',
      },
      {
        displayName: 'Conversation ID',
        name: 'conversationId',
        type: 'string',
        required: true,
        displayOptions: { show: { resource: ['conversation'], operation: ['get', 'getMessages', 'reply'] } },
        default: '',
        description: 'From Conversation → Get Many or the Chat33 Trigger (data.conversationId)',
      },
      {
        displayName: 'Message',
        name: 'message',
        type: 'string',
        typeOptions: { rows: 4 },
        required: true,
        displayOptions: { show: { resource: ['conversation'], operation: ['reply'] } },
        default: '',
        description:
          'Text to send. Instagram and Facebook only allow replies within 24 hours of the contact\'s last message.',
      },
      {
        displayName: 'Return All',
        name: 'returnAll',
        type: 'boolean',
        displayOptions: { show: { resource: ['conversation'], operation: ['getMany'] } },
        default: false,
        description: 'Whether to return all results or only up to a given limit',
      },
      {
        displayName: 'Limit',
        name: 'limit',
        type: 'number',
        typeOptions: { minValue: 1, maxValue: 50 },
        displayOptions: { show: { resource: ['conversation'], operation: ['getMany'], returnAll: [false] } },
        default: 50,
        description: 'Max number of results to return',
      },
      {
        displayName: 'Filters',
        name: 'conversationFilters',
        type: 'collection',
        placeholder: 'Add filter',
        displayOptions: { show: { resource: ['conversation'], operation: ['getMany'] } },
        default: {},
        options: [
          {
            displayName: 'Account Name or ID',
            name: 'channelId',
            type: 'options',
            typeOptions: { loadOptionsMethod: 'getAccounts' },
            default: '',
            description:
              'Only conversations of this connected account. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
          },
          {
            displayName: 'Needs Reply',
            name: 'needsReply',
            type: 'boolean',
            default: false,
            description: 'Whether to return only conversations where the contact is waiting for an answer',
          },
          {
            displayName: 'Platform',
            name: 'platform',
            type: 'options',
            default: 'instagram',
            options: [
              { name: 'Facebook', value: 'facebook' },
              { name: 'Instagram', value: 'instagram' },
              { name: 'WhatsApp', value: 'whatsapp' },
            ],
          },
          {
            displayName: 'Search',
            name: 'search',
            type: 'string',
            default: '',
            description: 'Match the contact\'s name or username',
          },
          {
            displayName: 'Status',
            name: 'status',
            type: 'options',
            default: 'open',
            options: [
              { name: 'Archived', value: 'archived' },
              { name: 'Closed', value: 'closed' },
              { name: 'Open', value: 'open' },
            ],
          },
          {
            displayName: 'Unread Only',
            name: 'unread',
            type: 'boolean',
            default: false,
            description: 'Whether to return only conversations with unread incoming messages',
          },
        ],
      },
      {
        displayName: 'Limit',
        name: 'messageLimit',
        type: 'number',
        typeOptions: { minValue: 1, maxValue: 100 },
        displayOptions: { show: { resource: ['conversation'], operation: ['getMessages'] } },
        default: 30,
        description: 'Max number of messages to return (the most recent ones)',
      },
      {
        displayName: 'Before',
        name: 'before',
        type: 'dateTime',
        displayOptions: { show: { resource: ['conversation'], operation: ['getMessages'] } },
        default: '',
        description: 'Only messages sent before this time, to page back through a long thread',
      },
      // ── Account ──
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['account'] } },
        options: [
          {
            name: 'Get Many',
            value: 'getMany',
            action: 'List connected social accounts',
            description: 'List the connected social accounts (channels)',
          },
        ],
        default: 'getMany',
      },
      {
        displayName: 'Platform',
        name: 'platform',
        type: 'options',
        displayOptions: { show: { resource: ['account'], operation: ['getMany'] } },
        options: [
          { name: 'All', value: '' },
          { name: 'Bluesky', value: 'bluesky' },
          { name: 'Facebook', value: 'facebook' },
          { name: 'Instagram', value: 'instagram' },
          { name: 'LinkedIn', value: 'linkedin' },
          { name: 'Threads', value: 'threads' },
          { name: 'TikTok', value: 'tiktok' },
          { name: 'X (Twitter)', value: 'x' },
          { name: 'YouTube', value: 'youtube' },
        ],
        default: '',
        description: 'Optionally filter by platform',
      },
      // ── Post ──
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['post'] } },
        options: [
          { name: 'Create', value: 'create', action: 'Create a post' },
          { name: 'Delete', value: 'delete', action: 'Cancel or delete a post' },
          { name: 'Duplicate', value: 'duplicate', action: 'Duplicate a post' },
          { name: 'Get', value: 'get', action: 'Get a post' },
          { name: 'Get Logs', value: 'getLogs', action: 'Get post delivery logs' },
          { name: 'Get Many', value: 'getMany', action: 'List posts' },
          { name: 'Validate', value: 'validate', action: 'Validate a post without creating it' },
        ],
        default: 'create',
      },
      {
        displayName: 'Account Names or IDs',
        name: 'accountIds',
        type: 'multiOptions',
        typeOptions: { loadOptionsMethod: 'getAccounts' },
        required: true,
        displayOptions: { show: { resource: ['post'], operation: ['create', 'validate'] } },
        default: [],
        description: 'Which connected accounts (channels) to post to. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
      },
      {
        displayName: 'Text',
        name: 'text',
        type: 'string',
        typeOptions: { rows: 4 },
        displayOptions: { show: { resource: ['post'], operation: ['create', 'validate'] } },
        default: '',
        description: 'Post caption/text',
      },
      {
        displayName: 'Media URLs',
        name: 'mediaUrls',
        type: 'string',
        displayOptions: { show: { resource: ['post'], operation: ['create', 'validate'] } },
        default: '',
        placeholder: 'https://... , https://...',
        description: 'Comma-separated https media URLs (use Media → Upload to host a file first)',
      },
      {
        displayName: 'Schedule At',
        name: 'scheduledAt',
        type: 'dateTime',
        displayOptions: { show: { resource: ['post'], operation: ['create'] } },
        default: '',
        description: 'Leave empty to publish immediately',
      },
      {
        displayName: 'Wait for Delivery',
        name: 'waitForDelivery',
        type: 'boolean',
        displayOptions: { show: { resource: ['post'], operation: ['create'] } },
        default: false,
        description:
          'Whether to wait until the post is actually live and return the final post URL. Multi-account posts wait for every account; a failure on one account does not fail the node — each post returns its own status. Skipped for scheduled posts.',
      },
      {
        displayName: 'Max Wait Time (Seconds)',
        name: 'waitMaxSeconds',
        type: 'number',
        displayOptions: { show: { resource: ['post'], operation: ['create'], waitForDelivery: [true] } },
        default: 300,
        description:
          'Give up waiting after this long. Posts still publishing are returned in their current state (QUEUED/PUBLISHING) rather than as an error — TikTok occasionally takes up to an hour.',
      },
      {
        displayName: 'Additional Options',
        name: 'additionalOptions',
        type: 'collection',
        placeholder: 'Add option',
        displayOptions: { show: { resource: ['post'], operation: ['create', 'validate'] } },
        default: {},
        options: [
          {
            displayName: 'Callback URL',
            name: 'callbackUrl',
            type: 'string',
            default: '',
            description: 'Webhook Chat33 calls when the post publishes or fails',
          },
          {
            displayName: 'Cover Image URL',
            name: 'coverImageUrl',
            type: 'string',
            default: '',
          },
          {
            displayName: 'Media Type',
            name: 'mediaType',
            type: 'options',
            options: [
              { name: 'Carousel', value: 'carousel' },
              { name: 'Image', value: 'image' },
              { name: 'Reel', value: 'reel' },
              { name: 'Video', value: 'video' },
            ],
            default: 'image',
          },
          {
            displayName: 'Platform Config (JSON)',
            name: 'platformConfigJson',
            type: 'json',
            default: '',
            description:
              'Per-platform settings, e.g. TikTok consent or YouTube madeForKids. Schema: GET {baseUrl}/api/v1/openapi.',
          },
          {
            displayName: 'Timezone',
            name: 'timezone',
            type: 'string',
            default: '',
            placeholder: 'Europe/Belgrade',
          },
        ],
      },
      {
        displayName: 'Configure Platform Settings',
        name: 'platformSettings',
        type: 'multiOptions',
        displayOptions: { show: { resource: ['post'], operation: ['create', 'validate'] } },
        default: [],
        description:
          'Which platforms to set typed options for. The account list holds channel IDs, so the node cannot tell which platforms you picked — say so here and only those settings appear. YouTube requires this: every YouTube upload must carry a Made for Kids declaration.',
        options: [
          {
            name: 'Bluesky',
            value: 'bluesky',
            description: 'Caption override (Bluesky allows 300 characters)',
          },
          {
            name: 'Facebook',
            value: 'facebook',
            description: 'Per-platform caption override',
          },
          {
            name: 'Instagram',
            value: 'instagram',
            description: 'Caption override and an auto-posted first comment',
          },
          {
            name: 'LinkedIn',
            value: 'linkedin',
            description: 'Visibility and article card fields',
          },
          {
            name: 'Threads',
            value: 'threads',
            description: 'Topic tag, reply permissions, poll, link card and sharing to your Instagram Story',
          },
          {
            name: 'TikTok',
            value: 'tiktok',
            description:
              'Publish mode, privacy and interaction toggles. Without this the post goes to your TikTok drafts instead of publishing.',
          },
          {
            name: 'X (Twitter)',
            value: 'x',
            description: 'Thread splitting and reply permissions',
          },
          {
            name: 'YouTube',
            value: 'youtube',
            description: 'Required for YouTube posts — carries the mandatory Made for Kids declaration',
          },
        ],
      },
      {
        displayName: 'Instagram Settings',
        name: 'instagramSettings',
        type: 'collection',
        placeholder: 'Add Instagram setting',
        displayOptions: {
          show: { resource: ['post'], operation: ['create', 'validate'], platformSettings: ['instagram'] },
        },
        default: {},
        options: [
          {
            displayName: 'Caption',
            name: 'text',
            type: 'string',
            typeOptions: { rows: 3 },
            default: '',
            description: 'Overrides the post text for Instagram only. Leave empty to use the shared text.',
          },
          {
            displayName: 'First Comment',
            name: 'firstComment',
            type: 'string',
            typeOptions: { rows: 2 },
            default: '',
            description:
              'Posted as the first comment right after publishing. The usual home for hashtags so they stay out of the caption.',
          },
        ],
      },
      {
        displayName: 'Facebook Settings',
        name: 'facebookSettings',
        type: 'collection',
        placeholder: 'Add Facebook setting',
        displayOptions: {
          show: { resource: ['post'], operation: ['create', 'validate'], platformSettings: ['facebook'] },
        },
        default: {},
        options: [
          {
            displayName: 'Caption',
            name: 'text',
            type: 'string',
            typeOptions: { rows: 3 },
            default: '',
            description: 'Overrides the post text for Facebook only. Leave empty to use the shared text.',
          },
        ],
      },
      {
        displayName: 'X Settings',
        name: 'xSettings',
        type: 'collection',
        placeholder: 'Add X setting',
        displayOptions: {
          show: { resource: ['post'], operation: ['create', 'validate'], platformSettings: ['x'] },
        },
        default: {},
        options: [
          {
            displayName: 'Post as Thread',
            name: 'thread',
            type: 'boolean',
            default: false,
            description:
              'Whether to split the text into a thread. Each chunk becomes its own post, chained as replies.',
          },
          {
            displayName: 'Reply Permissions',
            name: 'replyControl',
            type: 'options',
            default: 'everyone',
            description: 'Who is allowed to reply to the post',
            options: [
              { name: 'Everyone', value: 'everyone' },
              { name: 'Accounts You Follow', value: 'following' },
              { name: 'Mentioned Accounts Only', value: 'mentionedUsers' },
            ],
          },
          {
            displayName: 'Text',
            name: 'text',
            type: 'string',
            typeOptions: { rows: 3 },
            default: '',
            description: 'Overrides the post text for X only. Leave empty to use the shared text.',
          },
          {
            displayName: 'Thread Separator',
            name: 'splitOn',
            type: 'string',
            default: '---',
            description: 'The marker the text is split on when Post as Thread is enabled',
          },
        ],
      },
      {
        displayName: 'TikTok Settings',
        name: 'tiktokSettings',
        type: 'collection',
        placeholder: 'Add TikTok setting',
        displayOptions: {
          show: { resource: ['post'], operation: ['create', 'validate'], platformSettings: ['tiktok'] },
        },
        default: {},
        options: [
          {
            displayName: 'AI-Generated Content',
            name: 'aiGenerated',
            type: 'boolean',
            default: false,
            description: 'Whether to label the video as AI-generated on TikTok',
          },
          {
            displayName: 'Allow Comments',
            name: 'allowComments',
            type: 'boolean',
            default: false,
            description: 'Whether other users may comment on the post',
          },
          {
            displayName: 'Allow Duet',
            name: 'allowDuet',
            type: 'boolean',
            default: false,
            description: 'Whether other users may create Duets with the post',
          },
          {
            displayName: 'Allow Stitch',
            name: 'allowStitch',
            type: 'boolean',
            default: false,
            description: 'Whether other users may create Stitches with the post',
          },
          {
            displayName: 'Caption',
            name: 'text',
            type: 'string',
            typeOptions: { rows: 3 },
            default: '',
            description: 'Overrides the post text for TikTok only. Leave empty to use the shared text.',
          },
          {
            displayName: 'Disclose Branded Content',
            name: 'brandedContent',
            type: 'boolean',
            default: false,
            description:
              'Whether the post is a paid partnership promoting a third party (cannot be combined with Only Me privacy)',
          },
          {
            displayName: 'Disclose Your Brand',
            name: 'yourBrand',
            type: 'boolean',
            default: false,
            description: 'Whether the post promotes your own business',
          },
          {
            displayName: 'Privacy Level',
            name: 'privacyLevel',
            type: 'options',
            default: 'SELF_ONLY',
            description:
              'Who can view the post. Must be one of the options TikTok allows for the account.',
            options: [
              { name: 'Followers', value: 'FOLLOWER_OF_CREATOR' },
              { name: 'Friends', value: 'MUTUAL_FOLLOW_FRIENDS' },
              { name: 'Only Me', value: 'SELF_ONLY' },
              { name: 'Public', value: 'PUBLIC_TO_EVERYONE' },
            ],
          },
          {
            displayName: 'Publish Mode',
            name: 'publishMode',
            type: 'options',
            default: 'DIRECT_POST',
            description:
              'Direct Post publishes immediately; Draft sends the video to the user TikTok inbox to finish in the app',
            options: [
              { name: 'Direct Post', value: 'DIRECT_POST' },
              { name: 'Draft (Inbox)', value: 'MEDIA_UPLOAD' },
            ],
          },
        ],
      },
      {
        displayName: 'YouTube Settings',
        name: 'youtubeSettings',
        type: 'collection',
        placeholder: 'Add YouTube setting',
        displayOptions: {
          show: { resource: ['post'], operation: ['create', 'validate'], platformSettings: ['youtube'] },
        },
        default: {},
        options: [
          {
            displayName: 'Category ID',
            name: 'categoryId',
            type: 'string',
            default: '22',
            description:
              'YouTube category ID. 22 is People &amp; Blogs, 24 Entertainment, 27 Education, 28 Science &amp; Technology.',
          },
          {
            displayName: 'Description',
            name: 'description',
            type: 'string',
            typeOptions: { rows: 3 },
            default: '',
            description: 'Video description (falls back to the post text if empty)',
          },
          {
            displayName: 'Made for Kids',
            name: 'madeForKids',
            type: 'boolean',
            default: false,
            description:
              'Whether the video is made for kids. YouTube/FTC mandates this declaration on every upload, so Chat33 rejects a YouTube post without it.',
          },
          {
            displayName: 'Notify Subscribers',
            name: 'notifySubscribers',
            type: 'boolean',
            default: true,
            description: 'Whether to send the upload notification to your subscribers',
          },
          {
            displayName: 'Privacy',
            name: 'privacyStatus',
            type: 'options',
            default: 'public',
            description:
              'Who can see the video. Ignored for scheduled posts — those upload as private and YouTube flips them public at the scheduled time.',
            options: [
              { name: 'Private', value: 'private' },
              { name: 'Public', value: 'public' },
              { name: 'Unlisted', value: 'unlisted' },
            ],
          },
          {
            displayName: 'Tags',
            name: 'tags',
            type: 'string',
            default: '',
            placeholder: 'automation, n8n, tutorial',
            description: 'Comma-separated tags',
          },
          {
            displayName: 'Title',
            name: 'title',
            type: 'string',
            default: '',
            description: 'Video title (falls back to the post text if empty)',
          },
        ],
      },
      {
        displayName: 'LinkedIn Settings',
        name: 'linkedinSettings',
        type: 'collection',
        placeholder: 'Add LinkedIn setting',
        displayOptions: {
          show: { resource: ['post'], operation: ['create', 'validate'], platformSettings: ['linkedin'] },
        },
        default: {},
        options: [
          {
            displayName: 'Article URL',
            name: 'articleUrl',
            type: 'string',
            default: '',
            placeholder: 'https://example.com/post',
            description:
              'Share a link as a rich article card. Ignored when the post carries media — media takes precedence.',
          },
          {
            displayName: 'Caption',
            name: 'text',
            type: 'string',
            typeOptions: { rows: 3 },
            default: '',
            description: 'Overrides the post text for LinkedIn only. Leave empty to use the shared text.',
          },
          {
            displayName: 'Media Description',
            name: 'mediaDescription',
            type: 'string',
            default: '',
            description: 'Short description shown under the article card or media attachment',
          },
          {
            displayName: 'Media Title',
            name: 'mediaTitle',
            type: 'string',
            default: '',
            description: 'Title shown on the article card or media attachment',
          },
          {
            displayName: 'Visibility',
            name: 'visibility',
            type: 'options',
            default: 'PUBLIC',
            options: [
              { name: 'Connections Only', value: 'CONNECTIONS' },
              { name: 'Public', value: 'PUBLIC' },
            ],
            description: 'Who can see the post on LinkedIn',
          },
        ],
      },
      {
        displayName: 'Bluesky Settings',
        name: 'blueskySettings',
        type: 'collection',
        placeholder: 'Add Bluesky setting',
        displayOptions: {
          show: { resource: ['post'], operation: ['create', 'validate'], platformSettings: ['bluesky'] },
        },
        default: {},
        options: [
          {
            displayName: 'Caption',
            name: 'text',
            type: 'string',
            typeOptions: { rows: 3 },
            default: '',
            description:
              'Overrides the post text for Bluesky only (300 characters). Leave empty to use the shared text.',
          },
        ],
      },
      {
        displayName: 'Threads Settings',
        name: 'threadsSettings',
        type: 'collection',
        placeholder: 'Add Threads setting',
        displayOptions: {
          show: { resource: ['post'], operation: ['create', 'validate'], platformSettings: ['threads'] },
        },
        default: {},
        options: [
          {
            displayName: 'Link Card URL',
            name: 'linkAttachment',
            type: 'string',
            default: '',
            placeholder: 'https://example.com/post',
            description:
              'URL for the link preview card. Text posts only; without it Threads uses the first link in the text.',
          },
          {
            displayName: 'Poll Options',
            name: 'poll',
            type: 'string',
            default: '',
            placeholder: 'Red, Blue, Green',
            description: 'Comma-separated, 2 to 4 options of up to 25 characters each. Text posts only.',
          },
          {
            displayName: 'Reply Permissions',
            name: 'replyControl',
            type: 'options',
            default: 'everyone',
            description: 'Who is allowed to reply to the post',
            options: [
              { name: 'Accounts You Follow', value: 'accounts_you_follow' },
              { name: 'Everyone', value: 'everyone' },
              { name: 'Followers Only', value: 'followers_only' },
              { name: 'Mentioned Accounts Only', value: 'mentioned_only' },
              { name: 'Only You', value: 'parent_post_author_only' },
            ],
          },
          {
            displayName: 'Share to Instagram Story',
            name: 'shareToInstagramStory',
            type: 'boolean',
            default: false,
            description: 'Whether to also share the post to the linked Instagram account\'s Story',
          },
          {
            displayName: 'Topic Tag',
            name: 'topicTag',
            type: 'string',
            default: '',
            placeholder: 'launch',
            description: 'One topic tag, 1 to 50 characters without "." or "&". A leading # is dropped.',
          },
        ],
      },
      {
        displayName: 'Post ID',
        name: 'postId',
        type: 'string',
        required: true,
        displayOptions: {
          show: { resource: ['post'], operation: ['get', 'delete', 'duplicate', 'getLogs'] },
        },
        default: '',
      },
      {
        displayName: 'Filters',
        name: 'filters',
        type: 'collection',
        placeholder: 'Add filter',
        displayOptions: { show: { resource: ['post'], operation: ['getMany'] } },
        default: {},
        options: [
          {
            displayName: 'Account Name or ID',
            name: 'channelId',
            type: 'options',
            description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
            typeOptions: { loadOptionsMethod: 'getAccounts' },
            default: '',
          },
          {
            displayName: 'Limit',
            name: 'limit',
            type: 'number',
            default: 50,
            description: 'Max number of results to return',
            typeOptions: { minValue: 1 },
          },
          { displayName: 'Page', name: 'page', type: 'number', default: 1 },
          {
            displayName: 'Platform',
            name: 'platform',
            type: 'options',
            options: [
              { name: 'Facebook', value: 'facebook' },
              { name: 'Instagram', value: 'instagram' },
              { name: 'LinkedIn', value: 'linkedin' },
              { name: 'TikTok', value: 'tiktok' },
              { name: 'X (Twitter)', value: 'x' },
              { name: 'YouTube', value: 'youtube' },
            ],
            default: 'instagram',
          },
          {
            displayName: 'Status',
            name: 'status',
            type: 'options',
            options: [
              { name: 'Draft', value: 'draft' },
              { name: 'Failed', value: 'failed' },
              { name: 'Published', value: 'published' },
              { name: 'Queued', value: 'queued' },
              { name: 'Scheduled', value: 'scheduled' },
            ],
            default: 'published',
          },
        ],
      },
      // ── Media ──
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['media'] } },
        options: [
          { name: 'Upload', value: 'upload', action: 'Upload media to chat33 hosting' },
        ],
        default: 'upload',
      },
      {
        displayName: 'Input Type',
        name: 'inputType',
        type: 'options',
        displayOptions: { show: { resource: ['media'], operation: ['upload'] } },
        options: [
          { name: 'Binary File', value: 'binary', description: 'Upload a file from the incoming item (up to 500 MB)' },
          { name: 'URL', value: 'url', description: 'Let Chat33 ingest from a public URL (up to 4 GB)' },
        ],
        default: 'binary',
      },
      {
        displayName: 'Binary Property',
        name: 'binaryPropertyName',
        type: 'string',
        displayOptions: { show: { resource: ['media'], operation: ['upload'], inputType: ['binary'] } },
        default: 'data',
        description: 'Name of the binary property that holds the file',
      },
      {
        displayName: 'File URL',
        name: 'fileUrl',
        type: 'string',
        displayOptions: { show: { resource: ['media'], operation: ['upload'], inputType: ['url'] } },
        default: '',
        placeholder: 'https://example.com/video.mp4',
      },
    ],
  };

  methods = {
    loadOptions: {
      async getAccounts(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const res = await chat33ApiRequest.call(this, 'GET', '/api/v1/accounts');
        const accounts = Array.isArray(res.items) ? (res.items as IDataObject[]) : [];
        return accounts.map((a) => ({
          name: `${a.name || a.username || a.id} — ${a.platform}`,
          value: a.id as string,
        }));
      },
    },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];
    const resource = this.getNodeParameter('resource', 0) as string;
    const operation = this.getNodeParameter('operation', 0) as string;

    for (let i = 0; i < items.length; i++) {
      try {
        let responseData: IDataObject | IDataObject[] = {};

        if (resource === 'account' && operation === 'getMany') {
          const platform = this.getNodeParameter('platform', i, '') as string;
          const res = await chat33ApiRequest.call(
            this, 'GET', '/api/v1/accounts', undefined,
            platform ? { platform } : undefined,
          );
          responseData = Array.isArray(res.items) ? (res.items as IDataObject[]) : [];
        }

        if (resource === 'post' && (operation === 'create' || operation === 'validate')) {
          const additionalOptions = this.getNodeParameter('additionalOptions', i, {}) as IDataObject;
          if (
            typeof additionalOptions.platformConfigJson === 'string' &&
            additionalOptions.platformConfigJson.trim() &&
            !parsePlatformConfigJson(additionalOptions.platformConfigJson)
          ) {
            throw new NodeOperationError(this.getNode(), INVALID_PLATFORM_CONFIG_MESSAGE, {
              itemIndex: i,
            });
          }
          const body = buildCreatePostBody({
            accountIds: this.getNodeParameter('accountIds', i) as string[],
            text: this.getNodeParameter('text', i, '') as string,
            mediaUrls: this.getNodeParameter('mediaUrls', i, '') as string,
            scheduledAt:
              operation === 'create' ? (this.getNodeParameter('scheduledAt', i, '') as string) : '',
            additionalOptions,
            platformSettings: this.getNodeParameter('platformSettings', i, []) as string[],
            instagramSettings: this.getNodeParameter('instagramSettings', i, {}) as IDataObject,
            facebookSettings: this.getNodeParameter('facebookSettings', i, {}) as IDataObject,
            xSettings: this.getNodeParameter('xSettings', i, {}) as IDataObject,
            tiktokSettings: this.getNodeParameter('tiktokSettings', i, {}) as IDataObject,
            youtubeSettings: this.getNodeParameter('youtubeSettings', i, {}) as IDataObject,
            linkedinSettings: this.getNodeParameter('linkedinSettings', i, {}) as IDataObject,
            blueskySettings: this.getNodeParameter('blueskySettings', i, {}) as IDataObject,
            threadsSettings: this.getNodeParameter('threadsSettings', i, {}) as IDataObject,
          });
          const endpoint = operation === 'create' ? '/api/v1/posts' : '/api/v1/posts/validate';
          responseData = await chat33ApiRequest.call(this, 'POST', endpoint, body);

          const waitForDelivery =
            operation === 'create' && (this.getNodeParameter('waitForDelivery', i, false) as boolean);
          const createdPosts = (responseData as IDataObject)?.posts;
          if (waitForDelivery && Array.isArray(createdPosts) && createdPosts.length > 0) {
            const maxWaitSeconds = this.getNodeParameter('waitMaxSeconds', i, 300) as number;
            const finalPosts = await waitForPostsDelivery(
              createdPosts as IDataObject[],
              { maxWaitMs: Math.max(1, maxWaitSeconds) * 1000 },
              {
                fetchPost: (postId) => chat33ApiRequest.call(this, 'GET', `/api/v1/posts/${postId}`),
                sleep,
                now: () => Date.now(),
              },
            );
            responseData = { ...(responseData as IDataObject), posts: finalPosts };
          }
        }

        if (resource === 'post' && operation === 'get') {
          const postId = encodeURIComponent(this.getNodeParameter('postId', i) as string);
          responseData = await chat33ApiRequest.call(this, 'GET', `/api/v1/posts/${postId}`);
        }
        if (resource === 'post' && operation === 'getMany') {
          const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
          const res = await chat33ApiRequest.call(this, 'GET', '/api/v1/posts', undefined, filters);
          responseData = listItems(res);
        }
        if (resource === 'post' && operation === 'delete') {
          const postId = encodeURIComponent(this.getNodeParameter('postId', i) as string);
          responseData = await chat33ApiRequest.call(this, 'DELETE', `/api/v1/posts/${postId}`);
        }
        if (resource === 'post' && operation === 'duplicate') {
          const postId = encodeURIComponent(this.getNodeParameter('postId', i) as string);
          responseData = await chat33ApiRequest.call(this, 'POST', `/api/v1/posts/${postId}/duplicate`);
        }
        if (resource === 'post' && operation === 'getLogs') {
          const postId = encodeURIComponent(this.getNodeParameter('postId', i) as string);
          const res = await chat33ApiRequest.call(this, 'GET', `/api/v1/posts/${postId}/logs`);
          responseData = listItems(res);
        }

        if (resource === 'conversation' && operation === 'getMany') {
          const returnAll = this.getNodeParameter('returnAll', i, false) as boolean;
          const max = returnAll ? Infinity : (this.getNodeParameter('limit', i, 50) as number);
          const filters = this.getNodeParameter('conversationFilters', i, {}) as IDataObject;
          responseData = await collectConversations(max, (pageSize, cursor) =>
            chat33ApiRequest.call(
              this,
              'GET',
              '/api/v1/conversations',
              undefined,
              conversationQuery(filters, pageSize, cursor),
            ),
          );
        }
        if (resource === 'conversation' && operation === 'get') {
          const conversationId = encodeURIComponent(this.getNodeParameter('conversationId', i) as string);
          responseData = await chat33ApiRequest.call(this, 'GET', `/api/v1/conversations/${conversationId}`);
        }
        if (resource === 'conversation' && operation === 'getMessages') {
          const conversationId = encodeURIComponent(this.getNodeParameter('conversationId', i) as string);
          const before = this.getNodeParameter('before', i, '') as string;
          const res = await chat33ApiRequest.call(
            this,
            'GET',
            `/api/v1/conversations/${conversationId}/messages`,
            undefined,
            {
              limit: this.getNodeParameter('messageLimit', i, 30) as number,
              ...(before ? { before: new Date(before).toISOString() } : {}),
            },
          );
          responseData = Array.isArray(res.items) ? (res.items as IDataObject[]) : [];
        }
        if (resource === 'conversation' && operation === 'reply') {
          const conversationId = encodeURIComponent(this.getNodeParameter('conversationId', i) as string);
          const message = this.getNodeParameter('message', i) as string;
          responseData = await chat33ApiRequest.call(
            this,
            'POST',
            `/api/v1/conversations/${conversationId}/reply`,
            { message },
          );
        }

        if (resource === 'media' && operation === 'upload') {
          const inputType = this.getNodeParameter('inputType', i) as string;
          if (inputType === 'url') {
            const url = this.getNodeParameter('fileUrl', i) as string;
            responseData = await chat33ApiRequest.call(this, 'POST', '/api/v1/media/upload', { url });
          } else {
            const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
            const binaryData = this.helpers.assertBinaryData(i, binaryPropertyName);
            const buffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);
            responseData = await chat33UploadBuffer.call(
              this,
              buffer,
              binaryData.fileName || 'upload',
              binaryData.mimeType,
            );
          }
        }

        const arr = Array.isArray(responseData) ? responseData : [responseData];
        for (const entry of arr) {
          returnData.push({ json: entry, pairedItem: { item: i } });
        }
      } catch (error) {
        if (this.continueOnFail()) {
          returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
          continue;
        }
        // Both constructors hand back an error of their own type unchanged, so
        // the API's httpCode and description survive.
        if (error instanceof NodeApiError) throw new NodeApiError(this.getNode(), error as unknown as JsonObject);
        throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
      }
    }
    return [returnData];
  }
}
