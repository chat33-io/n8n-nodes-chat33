import type { IDataObject } from 'n8n-workflow';
import { collectConversations, conversationQuery } from './ConversationHelpers';

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
