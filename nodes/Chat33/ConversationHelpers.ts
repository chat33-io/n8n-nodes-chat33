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
