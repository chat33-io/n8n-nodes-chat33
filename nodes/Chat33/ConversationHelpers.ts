import type { IDataObject } from 'n8n-workflow';

/** GET /api/v1/conversations returns at most 50 per page. */
export const CONVERSATIONS_PAGE_MAX = 50;

/**
 * Filters → query string for GET /api/v1/conversations. Only set filters are
 * sent; the boolean ones only when switched on, since the API reads them as
 * "true" or absent.
 */
export function conversationQuery(filters: IDataObject, limit: number, cursor?: string): IDataObject {
  const qs: IDataObject = { limit: Math.min(Math.max(Math.floor(limit) || 1, 1), CONVERSATIONS_PAGE_MAX) };
  for (const key of ['platform', 'status', 'channelId', 'search']) {
    const value = typeof filters[key] === 'string' ? (filters[key] as string).trim() : '';
    if (value) qs[key] = value;
  }
  if (filters.needsReply === true) qs.needsReply = 'true';
  if (filters.unread === true) qs.unread = 'true';
  if (cursor) qs.cursor = cursor;
  return qs;
}

/**
 * Walks the cursor pages until `max` items (or the end when max is Infinity).
 * fetchPage is injected so the paging is testable without n8n.
 */
export async function collectConversations(
  max: number,
  fetchPage: (pageSize: number, cursor?: string) => Promise<IDataObject>,
): Promise<IDataObject[]> {
  const items: IDataObject[] = [];
  let cursor: string | undefined;
  do {
    const pageSize = Math.min(CONVERSATIONS_PAGE_MAX, max - items.length);
    const page = await fetchPage(pageSize, cursor);
    items.push(...(Array.isArray(page.items) ? (page.items as IDataObject[]) : []));
    cursor = typeof page.nextCursor === 'string' && page.nextCursor ? page.nextCursor : undefined;
  } while (cursor && items.length < max);
  return items.slice(0, max);
}

/** GET /api/v1/conversations/{id}/messages and GET /api/v1/posts return at most 100 per page. */
export const MESSAGES_PAGE_MAX = 100;
export const POSTS_PAGE_MAX = 100;

/**
 * Pages back through a thread: each page comes oldest-first with hasMore, and
 * the next request asks for messages before the oldest one received. Returns
 * the most recent `max` messages (all with Infinity), oldest first.
 */
export async function collectMessages(
  max: number,
  start: string | undefined,
  fetchPage: (pageSize: number, before?: string) => Promise<IDataObject>,
): Promise<IDataObject[]> {
  let items: IDataObject[] = [];
  let before = start;
  for (;;) {
    const pageSize = Math.min(MESSAGES_PAGE_MAX, max - items.length);
    const page = await fetchPage(pageSize, before);
    const got = Array.isArray(page.items) ? (page.items as IDataObject[]) : [];
    items = [...got, ...items];
    const oldest = got[0]?.sentAt;
    if (!page.hasMore || got.length === 0 || typeof oldest !== 'string' || oldest === before) break;
    if (items.length >= max) break;
    before = oldest;
  }
  return Number.isFinite(max) ? items.slice(-max) : items;
}

/** Walks GET /api/v1/posts pages until `max` posts or hasMore is false. */
export async function collectPosts(
  max: number,
  fetchPage: (page: number, pageSize: number) => Promise<IDataObject>,
): Promise<IDataObject[]> {
  const items: IDataObject[] = [];
  // A fixed page size keeps page numbers stable while we walk them.
  const pageSize = Number.isFinite(max) ? Math.min(POSTS_PAGE_MAX, Math.max(1, max)) : POSTS_PAGE_MAX;
  for (let page = 1; ; page++) {
    const res = await fetchPage(page, pageSize);
    const got = Array.isArray(res.items) ? (res.items as IDataObject[]) : [];
    items.push(...got);
    if (!res.hasMore || got.length === 0 || items.length >= max) break;
  }
  return Number.isFinite(max) ? items.slice(0, max) : items;
}
