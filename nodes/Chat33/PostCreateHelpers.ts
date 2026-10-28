import type { IDataObject } from 'n8n-workflow';

export const INVALID_PLATFORM_CONFIG_MESSAGE =
  'platformConfig must be valid JSON (see https://chat33.io/developers for the schema)';

/** Platform Config (JSON) as an object; undefined when blank or not a JSON object. */
export function parsePlatformConfigJson(raw: unknown): IDataObject | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as IDataObject)
      : undefined;
  } catch {
    return undefined;
  }
}

export function buildCreatePostBody(params: IDataObject): IDataObject {
  const body: IDataObject = { accountIds: params.accountIds };

  if (params.text) body.text = params.text;

  if (typeof params.mediaUrls === 'string' && params.mediaUrls.trim()) {
    body.mediaUrls = (params.mediaUrls as string)
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean);
  } else if (Array.isArray(params.mediaUrls) && params.mediaUrls.length) {
    body.mediaUrls = params.mediaUrls;
  }

  if (params.scheduledAt) body.scheduledAt = params.scheduledAt;

  const opts = (params.additionalOptions as IDataObject) || {};
  for (const key of ['mediaType', 'coverImageUrl', 'callbackUrl', 'timezone']) {
    if (opts[key]) body[key] = opts[key];
  }
  // The node refuses invalid JSON before calling this (it owns the error type).
  const platformConfig = parsePlatformConfigJson(opts.platformConfigJson);
  if (platformConfig) body.platformConfig = platformConfig;

  const enabled = new Set((params.platformSettings as string[]) || []);
  /**
   * A platform's typed settings apply when it is ticked in Configure Platform
   * Settings. Workflows built before that parameter existed have no ticks at
   * all, so a non-empty settings collection still counts — otherwise upgrading
   * the node would silently drop their config.
   */
  const wants = (platform: string, settings: IDataObject) =>
    enabled.has(platform) || Object.keys(settings).length > 0;

  /** Attach a platform's config, unless every field was left blank. */
  const attach = (platform: string, config: IDataObject) => {
    if (!Object.keys(config).length) return;
    const platformConfig = (body.platformConfig as IDataObject) || {};
    platformConfig[platform] = config;
    body.platformConfig = platformConfig;
  };

  const instagram = (params.instagramSettings as IDataObject) || {};
  if (wants('instagram', instagram)) {
    attach('instagram', {
      ...(instagram.text ? { text: instagram.text } : {}),
      ...(instagram.firstComment ? { firstComment: instagram.firstComment } : {}),
    });
  }

  const facebook = (params.facebookSettings as IDataObject) || {};
  if (wants('facebook', facebook)) {
    attach('facebook', {
      ...(facebook.text ? { text: facebook.text } : {}),
    });
  }

  const x = (params.xSettings as IDataObject) || {};
  if (wants('x', x)) {
    attach('x', {
      ...(x.text ? { text: x.text } : {}),
      ...('thread' in x ? { thread: !!x.thread } : {}),
      // splitOn only means anything alongside thread, and its default lives
      // server-side — forwarding it unasked would pin '---' forever.
      ...(x.thread && x.splitOn ? { splitOn: x.splitOn } : {}),
      ...(x.replyControl ? { replyControl: x.replyControl } : {}),
    });
  }

  const tiktok = (params.tiktokSettings as IDataObject) || {};
  if (wants('tiktok', tiktok)) {
    // Send only what the user actually set. Building the whole consent object
    // meant adding a single option rewrote all of it: picking just a privacy
    // level flipped allowComments/allowDuet/allowStitch to undefined, which
    // inverted into disable* = true and silently killed comments, duets and
    // stitches on the post. TikTok treats an absent flag as "not disabled".
    const consent: IDataObject = {};
    if (tiktok.publishMode) consent.publishMode = tiktok.publishMode;
    if (tiktok.privacyLevel) consent.privacyLevel = tiktok.privacyLevel;
    if ('allowComments' in tiktok) consent.disableComment = !tiktok.allowComments;
    if ('allowDuet' in tiktok) consent.disableDuet = !tiktok.allowDuet;
    if ('allowStitch' in tiktok) consent.disableStitch = !tiktok.allowStitch;
    if ('aiGenerated' in tiktok) consent.aiGenerated = !!tiktok.aiGenerated;

    // disclosureEnabled must agree with the two flags beneath it — Chat33
    // rejects it on its own — so the trio is set together or not at all.
    if ('yourBrand' in tiktok || 'brandedContent' in tiktok) {
      const yourBrand = !!tiktok.yourBrand;
      const brandedContent = !!tiktok.brandedContent;
      consent.disclosureEnabled = yourBrand || brandedContent;
      consent.disclosureYourBrand = yourBrand;
      consent.disclosureBrandedContent = brandedContent;
    }

    attach('tiktok', {
      ...(tiktok.text ? { text: tiktok.text } : {}),
      ...(Object.keys(consent).length ? { consent } : {}),
    });
  }

  const youtube = (params.youtubeSettings as IDataObject) || {};
  if (wants('youtube', youtube)) {
    // madeForKids goes out unconditionally: Chat33 rejects any YouTube post
    // without the declaration rather than defaulting it, so omitting it here
    // turned every YouTube post from n8n into a 400.
    attach('youtube', {
      madeForKids: !!youtube.madeForKids,
      ...(youtube.title ? { title: youtube.title } : {}),
      ...(youtube.description ? { description: youtube.description } : {}),
      ...(youtube.privacyStatus ? { privacyStatus: youtube.privacyStatus } : {}),
      ...(youtube.categoryId ? { categoryId: youtube.categoryId } : {}),
      ...('notifySubscribers' in youtube
        ? { notifySubscribers: !!youtube.notifySubscribers }
        : {}),
      ...(typeof youtube.tags === 'string' && youtube.tags.trim()
        ? {
            tags: youtube.tags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean),
          }
        : {}),
    });
  }

  // Only forward keys the user actually set — every LinkedIn option has a
  // server-side default, so sending empty strings would override those
  // defaults with nothing.
  const linkedin = (params.linkedinSettings as IDataObject) || {};
  if (wants('linkedin', linkedin)) {
    attach('linkedin', {
      ...(linkedin.text ? { text: linkedin.text } : {}),
      ...(linkedin.visibility ? { visibility: linkedin.visibility } : {}),
      ...(linkedin.articleUrl ? { articleUrl: linkedin.articleUrl } : {}),
      ...(linkedin.mediaTitle ? { mediaTitle: linkedin.mediaTitle } : {}),
      ...(linkedin.mediaDescription ? { mediaDescription: linkedin.mediaDescription } : {}),
    });
  }

  const bluesky = (params.blueskySettings as IDataObject) || {};
  if (wants('bluesky', bluesky)) {
    attach('bluesky', {
      ...(bluesky.text ? { text: bluesky.text } : {}),
    });
  }

  // Threads has no caption override: the shared text is what goes out.
  const threads = (params.threadsSettings as IDataObject) || {};
  if (wants('threads', threads)) {
    const poll =
      typeof threads.poll === 'string'
        ? threads.poll
            .split(',')
            .map((o) => o.trim())
            .filter(Boolean)
        : [];
    attach('threads', {
      ...(threads.topicTag ? { topicTag: threads.topicTag } : {}),
      ...(threads.replyControl ? { replyControl: threads.replyControl } : {}),
      ...(poll.length ? { poll } : {}),
      ...(threads.linkAttachment ? { linkAttachment: threads.linkAttachment } : {}),
      ...('shareToInstagramStory' in threads
        ? { shareToInstagramStory: !!threads.shareToInstagramStory }
        : {}),
    });
  }

  return body;
}

/** Statuses a post can no longer leave — polling past these is pointless. */
export const TERMINAL_POST_STATUSES = ['PUBLISHED', 'FAILED', 'CANCELLED'];

export interface WaitForDeliveryDeps {
  fetchPost: (postId: string) => Promise<IDataObject>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

/**
 * Poll created posts until every one reaches a terminal status or the wait
 * budget runs out.
 *
 * Rules that came out of real questions rather than theory:
 * - Scheduled posts are returned untouched — a post queued for next month
 *   will not publish inside this workflow run, so waiting on it is nonsense.
 * - A multi-account create waits for ALL its posts, and a failure on one
 *   account does not throw: each post comes back with its own final status
 *   (and errorMessage), so the workflow can branch per platform.
 * - On timeout the still-pending posts are returned in their latest known
 *   state (QUEUED/PUBLISHING), never as an error — TikTok in particular can
 *   take up to an hour in edge cases, and that is not a workflow failure.
 */
export async function waitForPostsDelivery(
  posts: IDataObject[],
  opts: { maxWaitMs: number; intervalMs?: number },
  deps: WaitForDeliveryDeps,
): Promise<IDataObject[]> {
  const intervalMs = opts.intervalMs ?? 5000;
  const deadline = deps.now() + opts.maxWaitMs;

  const result = posts.map((p) => ({ ...p }));
  const pending = new Map<number, string>();
  result.forEach((p, index) => {
    const terminal = TERMINAL_POST_STATUSES.includes(String(p.status));
    if (!p.scheduledAt && p.id && !terminal) pending.set(index, String(p.id));
  });

  while (pending.size > 0 && deps.now() < deadline) {
    await deps.sleep(intervalMs);
    for (const [index, id] of Array.from(pending.entries())) {
      const fresh = await deps.fetchPost(id);
      result[index] = { ...result[index], ...fresh };
      if (TERMINAL_POST_STATUSES.includes(String(fresh.status))) pending.delete(index);
    }
  }

  return result;
}
