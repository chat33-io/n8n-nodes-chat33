import type { IDataObject } from 'n8n-workflow';
import { buildCreatePostBody, parsePlatformConfigJson, waitForPostsDelivery } from './PostCreateHelpers';

describe('buildCreatePostBody', () => {
  it('builds a minimal body', () => {
    expect(
      buildCreatePostBody({ accountIds: ['ch1', 'ch2'], text: 'hello' }),
    ).toEqual({ accountIds: ['ch1', 'ch2'], text: 'hello' });
  });

  it('splits comma-separated media urls and trims', () => {
    const body = buildCreatePostBody({
      accountIds: ['ch1'],
      mediaUrls: ' https://a.com/1.jpg , https://a.com/2.jpg ',
    });
    expect(body.mediaUrls).toEqual(['https://a.com/1.jpg', 'https://a.com/2.jpg']);
  });

  it('passes scheduledAt and options through', () => {
    const body = buildCreatePostBody({
      accountIds: ['ch1'],
      text: 't',
      scheduledAt: '2026-08-01T10:00:00.000Z',
      additionalOptions: { mediaType: 'video', timezone: 'Europe/Belgrade', callbackUrl: 'https://hook' },
    });
    expect(body).toMatchObject({
      scheduledAt: '2026-08-01T10:00:00.000Z',
      mediaType: 'video',
      timezone: 'Europe/Belgrade',
      callbackUrl: 'https://hook',
    });
  });

  it('parses platformConfig JSON string and rejects invalid JSON', () => {
    const body = buildCreatePostBody({
      accountIds: ['ch1'],
      additionalOptions: { platformConfigJson: '{"tiktok":{"consent":{"publishMode":"MEDIA_UPLOAD"}}}' },
    });
    expect(body.platformConfig).toEqual({ tiktok: { consent: { publishMode: 'MEDIA_UPLOAD' } } });
    expect(parsePlatformConfigJson('{nope')).toBeUndefined();
    expect(parsePlatformConfigJson('[1]')).toBeUndefined();
    expect(parsePlatformConfigJson('  ')).toBeUndefined();
  });

  it('does not add platformConfig when tiktokSettings/youtubeSettings are empty or absent', () => {
    const body = buildCreatePostBody({
      accountIds: ['ch1'],
      text: 'hello',
      tiktokSettings: {},
    });
    expect(body).toEqual({ accountIds: ['ch1'], text: 'hello' });
    expect(body.platformConfig).toBeUndefined();
  });

  it('sends only the tiktok options the user actually set', () => {
    // Regression: this used to emit the whole consent object, so choosing a
    // privacy level alone inverted the unset allow* toggles into
    // disableDuet/disableStitch = true and silently killed duets and stitches.
    const body = buildCreatePostBody({
      accountIds: ['ch1'],
      platformSettings: ['tiktok'],
      tiktokSettings: { privacyLevel: 'SELF_ONLY', allowComments: true },
    });
    expect((body.platformConfig as IDataObject).tiktok).toEqual({
      consent: {
        privacyLevel: 'SELF_ONLY',
        disableComment: false,
      },
    });
  });

  it('does not invent a publish mode — an untouched mode means drafts, not a live post', () => {
    const body = buildCreatePostBody({
      accountIds: ['ch1'],
      platformSettings: ['tiktok'],
      tiktokSettings: { allowComments: true },
    });
    const consent = ((body.platformConfig as IDataObject).tiktok as IDataObject)
      .consent as IDataObject;
    expect(consent.publishMode).toBeUndefined();
    expect(consent.privacyLevel).toBeUndefined();
  });

  it('keeps the disclosure trio consistent, since Chat33 rejects a lone flag', () => {
    const body = buildCreatePostBody({
      accountIds: ['ch1'],
      platformSettings: ['tiktok'],
      tiktokSettings: { yourBrand: true },
    });
    const consent = ((body.platformConfig as IDataObject).tiktok as IDataObject)
      .consent as IDataObject;
    expect(consent.disclosureEnabled).toBe(true);
    expect(consent.disclosureYourBrand).toBe(true);
    expect(consent.disclosureBrandedContent).toBe(false);
  });

  it('omits tiktok config entirely when the platform is ticked but nothing is set', () => {
    const body = buildCreatePostBody({
      accountIds: ['ch1'],
      platformSettings: ['tiktok'],
      tiktokSettings: {},
    });
    expect(body.platformConfig).toBeUndefined();
  });

  it('enables disclosure when brandedContent is set', () => {
    const body = buildCreatePostBody({
      accountIds: ['ch1'],
      tiktokSettings: { brandedContent: true },
    });
    const consent = ((body.platformConfig as IDataObject).tiktok as IDataObject).consent as IDataObject;
    expect(consent.disclosureEnabled).toBe(true);
    expect(consent.disclosureBrandedContent).toBe(true);
  });

  it('merges typed tiktokSettings with platformConfigJson, typed settings take precedence for tiktok key', () => {
    const body = buildCreatePostBody({
      accountIds: ['ch1'],
      additionalOptions: { platformConfigJson: '{"youtube":{"madeForKids":false}}' },
      tiktokSettings: { publishMode: 'MEDIA_UPLOAD' },
    });
    const platformConfig = body.platformConfig as IDataObject;
    expect(platformConfig.youtube).toEqual({ madeForKids: false });
    expect((platformConfig.tiktok as IDataObject).consent).toMatchObject({ publishMode: 'MEDIA_UPLOAD' });
  });

  it('builds youtube settings, omitting empty title', () => {
    const body = buildCreatePostBody({
      accountIds: ['ch1'],
      youtubeSettings: { madeForKids: true, title: 'Hi' },
    });
    expect((body.platformConfig as IDataObject).youtube).toEqual({ madeForKids: true, title: 'Hi' });

    const body2 = buildCreatePostBody({
      accountIds: ['ch1'],
      youtubeSettings: { madeForKids: false, title: '' },
    });
    expect((body2.platformConfig as IDataObject).youtube).toEqual({ madeForKids: false });
  });

  it('always declares madeForKids once YouTube is ticked — Chat33 400s without it', () => {
    const body = buildCreatePostBody({
      accountIds: ['ch1'],
      platformSettings: ['youtube'],
      youtubeSettings: {},
    });
    expect((body.platformConfig as IDataObject).youtube).toEqual({ madeForKids: false });
  });

  it('carries privacy and the rest of the youtube fields', () => {
    const body = buildCreatePostBody({
      accountIds: ['ch1'],
      platformSettings: ['youtube'],
      youtubeSettings: {
        madeForKids: false,
        privacyStatus: 'unlisted',
        description: 'desc',
        categoryId: '27',
        notifySubscribers: false,
        tags: ' n8n , automation ,, ',
      },
    });
    expect((body.platformConfig as IDataObject).youtube).toEqual({
      madeForKids: false,
      description: 'desc',
      privacyStatus: 'unlisted',
      categoryId: '27',
      notifySubscribers: false,
      tags: ['n8n', 'automation'],
    });
  });
});

describe('buildCreatePostBody — Instagram, Facebook and X', () => {
  it('maps the Instagram first comment, the usual home for hashtags', () => {
    const body = buildCreatePostBody({
      accountIds: ['ch1'],
      text: 'shared caption',
      platformSettings: ['instagram'],
      instagramSettings: { firstComment: '#automation #n8n' },
    });
    expect((body.platformConfig as IDataObject).instagram).toEqual({
      firstComment: '#automation #n8n',
    });
    expect(body.text).toBe('shared caption');
  });

  it('lets each platform override the shared caption', () => {
    const body = buildCreatePostBody({
      accountIds: ['ch1', 'ch2'],
      text: 'shared',
      platformSettings: ['instagram', 'facebook'],
      instagramSettings: { text: 'for insta' },
      facebookSettings: { text: 'for fb' },
    });
    const pc = body.platformConfig as IDataObject;
    expect(pc.instagram).toEqual({ text: 'for insta' });
    expect(pc.facebook).toEqual({ text: 'for fb' });
    expect(body.text).toBe('shared');
  });

  it('maps X thread settings', () => {
    const body = buildCreatePostBody({
      accountIds: ['ch1'],
      platformSettings: ['x'],
      xSettings: { thread: true, splitOn: '###', replyControl: 'following' },
    });
    expect((body.platformConfig as IDataObject).x).toEqual({
      thread: true,
      splitOn: '###',
      replyControl: 'following',
    });
  });

  it('drops the separator when threading is off, so the server default stands', () => {
    const body = buildCreatePostBody({
      accountIds: ['ch1'],
      platformSettings: ['x'],
      xSettings: { thread: false, splitOn: '###' },
    });
    expect((body.platformConfig as IDataObject).x).toEqual({ thread: false });
  });

  it('carries a TikTok caption override alongside consent', () => {
    const body = buildCreatePostBody({
      accountIds: ['ch1'],
      platformSettings: ['tiktok'],
      tiktokSettings: { text: 'tiktok caption', privacyLevel: 'SELF_ONLY' },
    });
    expect((body.platformConfig as IDataObject).tiktok).toEqual({
      text: 'tiktok caption',
      consent: { privacyLevel: 'SELF_ONLY' },
    });
  });

  it('omits platforms ticked but left blank', () => {
    const body = buildCreatePostBody({
      accountIds: ['ch1'],
      platformSettings: ['instagram', 'facebook', 'x'],
      instagramSettings: {},
      facebookSettings: {},
      xSettings: {},
    });
    expect(body.platformConfig).toBeUndefined();
  });
});

describe('buildCreatePostBody — platform gating', () => {
  it('honours workflows saved before Configure Platform Settings existed', () => {
    // Those have no platformSettings at all; a non-empty collection still counts,
    // otherwise upgrading the node would silently drop their configuration.
    const body = buildCreatePostBody({
      accountIds: ['ch1'],
      youtubeSettings: { madeForKids: true },
      linkedinSettings: { visibility: 'PUBLIC' },
    });
    const pc = body.platformConfig as IDataObject;
    expect(pc.youtube).toEqual({ madeForKids: true });
    expect(pc.linkedin).toEqual({ visibility: 'PUBLIC' });
  });

  it('leaves out platforms that are neither ticked nor filled in', () => {
    const body = buildCreatePostBody({
      accountIds: ['ch1'],
      platformSettings: ['youtube'],
      youtubeSettings: { madeForKids: false },
      linkedinSettings: {},
      tiktokSettings: {},
    });
    const pc = body.platformConfig as IDataObject;
    expect(pc.youtube).toBeDefined();
    expect(pc.linkedin).toBeUndefined();
    expect(pc.tiktok).toBeUndefined();
  });

  it('does not emit an empty linkedin object when ticked but left blank', () => {
    const body = buildCreatePostBody({
      accountIds: ['ch1'],
      platformSettings: ['linkedin'],
      linkedinSettings: {},
    });
    expect(body.platformConfig).toBeUndefined();
  });
});

describe('buildCreatePostBody — LinkedIn', () => {
  it('maps LinkedIn settings into platformConfig.linkedin', () => {
    const body = buildCreatePostBody({
      accountIds: ['c-li'],
      text: 'hello',
      linkedinSettings: { visibility: 'CONNECTIONS', articleUrl: 'https://chat33.io/blog' },
    });
    expect((body.platformConfig as IDataObject).linkedin).toEqual({
      visibility: 'CONNECTIONS',
      articleUrl: 'https://chat33.io/blog',
    });
  });

  it('drops empty fields so server defaults survive', () => {
    const body = buildCreatePostBody({
      accountIds: ['c-li'],
      text: 'hi',
      linkedinSettings: { visibility: 'PUBLIC', articleUrl: '', mediaTitle: '' },
    });
    expect((body.platformConfig as IDataObject).linkedin).toEqual({ visibility: 'PUBLIC' });
  });

  it('leaves platformConfig alone when no LinkedIn settings are set', () => {
    const body = buildCreatePostBody({ accountIds: ['c-li'], text: 'hi', linkedinSettings: {} });
    expect(body.platformConfig).toBeUndefined();
  });

  it('coexists with TikTok settings on a multi-platform post', () => {
    const body = buildCreatePostBody({
      accountIds: ['c-li', 'c-tt'],
      text: 'hi',
      tiktokSettings: { privacyLevel: 'SELF_ONLY' },
      linkedinSettings: { visibility: 'PUBLIC' },
    });
    expect(body.platformConfig).toMatchObject({
      linkedin: { visibility: 'PUBLIC' },
      tiktok: { consent: { privacyLevel: 'SELF_ONLY' } },
    });
  });
});

describe('waitForPostsDelivery', () => {
  function fakeDeps(fetchScript: Record<string, IDataObject[]>) {
    // Each post id maps to a queue of successive fetch results.
    let clock = 0;
    return {
      deps: {
        fetchPost: jest.fn(async (id: string) => {
          const queue = fetchScript[id] || [];
          return queue.length > 1 ? queue.shift()! : queue[0] || { id, status: 'QUEUED' };
        }),
        sleep: jest.fn(async () => {
          clock += 5000;
        }),
        now: () => clock,
      },
    };
  }

  it('polls until every post is terminal and merges the final state', async () => {
    const { deps } = fakeDeps({
      p1: [{ id: 'p1', status: 'PUBLISHING' }, { id: 'p1', status: 'PUBLISHED', externalPostUrl: 'https://yt/1' }],
      p2: [{ id: 'p2', status: 'PUBLISHED', externalPostUrl: 'https://ig/2' }],
    });

    const result = await waitForPostsDelivery(
      [{ id: 'p1', status: 'QUEUED' }, { id: 'p2', status: 'QUEUED' }],
      { maxWaitMs: 60_000 },
      deps,
    );

    expect(result[0]).toMatchObject({ status: 'PUBLISHED', externalPostUrl: 'https://yt/1' });
    expect(result[1]).toMatchObject({ status: 'PUBLISHED', externalPostUrl: 'https://ig/2' });
  });

  it('one failing account does not fail the others — each returns its own status', async () => {
    const { deps } = fakeDeps({
      ok: [{ id: 'ok', status: 'PUBLISHED', externalPostUrl: 'https://x/ok' }],
      bad: [{ id: 'bad', status: 'FAILED', errorMessage: 'TikTok rejected this post' }],
    });

    const result = await waitForPostsDelivery(
      [{ id: 'ok', status: 'QUEUED' }, { id: 'bad', status: 'QUEUED' }],
      { maxWaitMs: 60_000 },
      deps,
    );

    expect(result[0].status).toBe('PUBLISHED');
    expect(result[1]).toMatchObject({ status: 'FAILED', errorMessage: 'TikTok rejected this post' });
  });

  it('never waits on scheduled posts — a post queued for next month cannot go live now', async () => {
    const { deps } = fakeDeps({});
    const scheduled = { id: 's1', status: 'QUEUED', scheduledAt: '2026-08-30T10:00:00.000Z' };

    const result = await waitForPostsDelivery([scheduled], { maxWaitMs: 60_000 }, deps);

    expect(deps.fetchPost).not.toHaveBeenCalled();
    expect(deps.sleep).not.toHaveBeenCalled();
    expect(result[0]).toEqual(scheduled);
  });

  it('returns pending posts in their latest state on timeout instead of throwing', async () => {
    const { deps } = fakeDeps({
      slow: [{ id: 'slow', status: 'PUBLISHING' }],
    });

    const result = await waitForPostsDelivery(
      [{ id: 'slow', status: 'QUEUED' }],
      { maxWaitMs: 12_000 }, // two 5s polls, then deadline
      deps,
    );

    expect(result[0].status).toBe('PUBLISHING');
  });

  it('stops polling a post once it is terminal while others continue', async () => {
    const { deps } = fakeDeps({
      fast: [{ id: 'fast', status: 'PUBLISHED' }],
      slow: [{ id: 'slow', status: 'PUBLISHING' }, { id: 'slow', status: 'PUBLISHING' }, { id: 'slow', status: 'PUBLISHED' }],
    });

    await waitForPostsDelivery(
      [{ id: 'fast', status: 'QUEUED' }, { id: 'slow', status: 'QUEUED' }],
      { maxWaitMs: 60_000 },
      deps,
    );

    const fastCalls = (deps.fetchPost as jest.Mock).mock.calls.filter(([id]) => id === 'fast').length;
    expect(fastCalls).toBe(1);
  });
});

describe('buildCreatePostBody — Bluesky and Threads', () => {
  it('maps the Bluesky caption override', () => {
    const body = buildCreatePostBody({ accountIds: ['c-bs'], text: 'hi', blueskySettings: { text: 'short one' } });
    expect(body.platformConfig).toEqual({ bluesky: { text: 'short one' } });
  });

  it('maps Threads options and splits the poll into options', () => {
    const body = buildCreatePostBody({
      accountIds: ['c-th'],
      text: 'which one?',
      threadsSettings: {
        topicTag: '#launch',
        replyControl: 'followers_only',
        poll: ' Red , Blue,,Green ',
        shareToInstagramStory: true,
      },
    });
    expect(body.platformConfig).toEqual({
      threads: {
        topicTag: '#launch',
        replyControl: 'followers_only',
        poll: ['Red', 'Blue', 'Green'],
        shareToInstagramStory: true,
      },
    });
  });

  it('sends the link card URL and leaves out blank fields', () => {
    const body = buildCreatePostBody({
      accountIds: ['c-th'],
      text: 'read this',
      threadsSettings: { topicTag: '', poll: '  ', linkAttachment: 'https://chat33.io/blog' },
    });
    expect(body.platformConfig).toEqual({ threads: { linkAttachment: 'https://chat33.io/blog' } });
  });

  it('sends shareToInstagramStory false only when it was set', () => {
    const off = buildCreatePostBody({ accountIds: ['c'], threadsSettings: { shareToInstagramStory: false } });
    expect(off.platformConfig).toEqual({ threads: { shareToInstagramStory: false } });
    const unset = buildCreatePostBody({ accountIds: ['c'], threadsSettings: {}, platformSettings: ['threads'] });
    expect(unset.platformConfig).toBeUndefined();
  });
});
