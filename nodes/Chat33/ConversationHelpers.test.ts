import type { IDataObject } from 'n8n-workflow';
import { collectConversations, collectMessages, collectPosts, conversationQuery } from './ConversationHelpers';

describe('conversationQuery', () => {
  it('sends only the filters that are set', () => {
    expect(conversationQuery({}, 20)).toEqual({ limit: 20 });
    expect(
      conversationQuery({ platform: 'instagram', status: 'open', search: '  ana ', channelId: '' }, 10),
    ).toEqual({ limit: 10, platform: 'instagram', status: 'open', search: 'ana' });
  });

  it('sends the switches only when on', () => {
    expect(conversationQuery({ needsReply: true, unread: false }, 5)).toEqual({ limit: 5, needsReply: 'true' });
  });

  it('keeps the page size inside 1 to 50 and adds the cursor', () => {
    expect(conversationQuery({}, 500, 'c1')).toEqual({ limit: 50, cursor: 'c1' });
    expect(conversationQuery({}, 0)).toEqual({ limit: 1 });
  });
});

describe('collectConversations', () => {
  const pages: Record<string, IDataObject> = {
    first: { items: [{ id: 'a' }, { id: 'b' }], nextCursor: 'b' },
    b: { items: [{ id: 'c' }], nextCursor: null },
  };

  it('follows the cursor to the end for Return All', async () => {
    const calls: Array<[number, string | undefined]> = [];
    const items = await collectConversations(Infinity, async (size, cursor) => {
      calls.push([size, cursor]);
      return pages[cursor ?? 'first'];
    });
    expect(items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(calls).toEqual([
      [50, undefined],
      [50, 'b'],
    ]);
  });

  it('stops at the limit without fetching another page', async () => {
    const fetchPage = jest.fn(async (_size: number, cursor?: string) => pages[cursor ?? 'first']);
    const items = await collectConversations(2, fetchPage);
    expect(items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(2, undefined);
  });
});

describe('collectMessages (Return All / Limit, v2)', () => {
  // A thread of 250 messages, m1 oldest … m250 newest; the API returns pages
  // oldest-first with hasMore, paging back with `before`.
  const thread = Array.from({ length: 250 }, (_, k) => ({
    id: `m${k + 1}`,
    sentAt: new Date(Date.UTC(2026, 0, 1, 0, k)).toISOString(),
  }));
  const api = jest.fn(async (pageSize: number, before?: string) => {
    const older = before ? thread.filter((m) => m.sentAt < before) : thread;
    const page = older.slice(-pageSize);
    return { items: page, hasMore: older.length > pageSize };
  });
  beforeEach(() => api.mockClear());

  it('returns the most recent N, oldest first', async () => {
    const out = await collectMessages(30, undefined, api);
    expect(out.map((m) => m.id)).toEqual(thread.slice(-30).map((m) => m.id));
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('pages back past 100 to reach the limit', async () => {
    const out = await collectMessages(150, undefined, api);
    expect(out).toHaveLength(150);
    expect(out[0].id).toBe('m101');
    expect(out[149].id).toBe('m250');
    expect(api).toHaveBeenCalledTimes(2);
  });

  it('Return All walks the whole thread', async () => {
    const out = await collectMessages(Infinity, undefined, api);
    expect(out).toHaveLength(250);
    expect(out[0].id).toBe('m1');
    expect(api).toHaveBeenCalledTimes(3);
  });

  it('starts from Before when given', async () => {
    const out = await collectMessages(10, thread[100].sentAt, api);
    expect(out.map((m) => m.id)).toEqual(thread.slice(90, 100).map((m) => m.id));
  });
});

describe('collectPosts (Return All / Limit, v2)', () => {
  const posts = Array.from({ length: 230 }, (_, k) => ({ id: `p${k + 1}` }));
  const api = jest.fn(async (page: number, pageSize: number) => ({
    items: posts.slice((page - 1) * pageSize, page * pageSize),
    hasMore: page * pageSize < posts.length,
  }));
  beforeEach(() => api.mockClear());

  it('one page for a small limit', async () => {
    const out = await collectPosts(20, api);
    expect(out).toHaveLength(20);
    expect(api).toHaveBeenCalledWith(1, 20);
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('several pages for a limit over 100', async () => {
    const out = await collectPosts(150, api);
    expect(out.map((p) => p.id)).toEqual(posts.slice(0, 150).map((p) => p.id));
    expect(api).toHaveBeenCalledTimes(2);
  });

  it('Return All stops when hasMore is false', async () => {
    const out = await collectPosts(Infinity, api);
    expect(out).toHaveLength(230);
    expect(api).toHaveBeenCalledTimes(3);
  });
});
