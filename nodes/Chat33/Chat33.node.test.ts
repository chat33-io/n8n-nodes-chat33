/**
 * Regression: the TikTok, YouTube and LinkedIn settings collections all carried
 * the identical condition `{ resource: ['post'], operation: ['create','validate'] }`,
 * so all three rendered no matter which channels were picked — LinkedIn options
 * showed on a YouTube/Instagram/TikTok post. The account list holds channel IDs
 * and n8n's displayOptions only do exact value matching, so the platform can
 * never be inferred from it; the Configure Platform Settings picker is what
 * gates them now.
 */
import { Chat33 } from './Chat33.node';
import type { INodeProperties } from 'n8n-workflow';

const props = new Chat33().description.properties as INodeProperties[];
const byName = (name: string) => props.find((p) => p.name === name);

describe('platform settings gating', () => {
  it('exposes a picker for the platforms whose settings can be configured', () => {
    const picker = byName('platformSettings');
    expect(picker).toBeDefined();
    expect(picker!.type).toBe('multiOptions');
    expect(picker!.default).toEqual([]);
    const values = (picker!.options as Array<{ value: string }>).map((o) => o.value);
    expect(values.sort()).toEqual([
      'bluesky',
      'facebook',
      'instagram',
      'linkedin',
      'threads',
      'tiktok',
      'x',
      'youtube',
    ]);
  });

  it.each([
    ['instagramSettings', 'instagram'],
    ['facebookSettings', 'facebook'],
    ['xSettings', 'x'],
    ['tiktokSettings', 'tiktok'],
    ['youtubeSettings', 'youtube'],
    ['linkedinSettings', 'linkedin'],
    ['blueskySettings', 'bluesky'],
    ['threadsSettings', 'threads'],
  ])('%s only shows when %s is picked', (paramName, platform) => {
    const param = byName(paramName);
    expect(param).toBeDefined();
    expect(param!.displayOptions?.show?.platformSettings).toEqual([platform]);
  });

  it('gives every collection its own condition', () => {
    const names = [
      'instagramSettings',
      'facebookSettings',
      'xSettings',
      'tiktokSettings',
      'youtubeSettings',
      'linkedinSettings',
      'blueskySettings',
      'threadsSettings',
    ];
    const conditions = names.map((n) => JSON.stringify(byName(n)!.displayOptions));
    expect(new Set(conditions).size).toBe(names.length);
  });

  it('covers every platform Chat33 accepts platformConfig for', () => {
    // The API namespaces platformConfig per platform; anything missing here is
    // only reachable by hand-writing Platform Config JSON.
    const picker = byName('platformSettings')!;
    const values = (picker.options as Array<{ value: string }>).map((o) => o.value);
    for (const platform of ['instagram', 'facebook', 'tiktok', 'youtube', 'x', 'linkedin', 'bluesky', 'threads']) {
      expect(values).toContain(platform);
      expect(byName(`${platform === 'x' ? 'x' : platform}Settings`)).toBeDefined();
    }
  });
});

describe('youtube settings', () => {
  const options = () =>
    (byName('youtubeSettings')!.options as INodeProperties[]).map((o) => o.name);

  it('offers a privacy control — uploads used to always go out public', () => {
    const privacy = (byName('youtubeSettings')!.options as INodeProperties[]).find(
      (o) => o.name === 'privacyStatus',
    );
    expect(privacy).toBeDefined();
    expect((privacy!.options as Array<{ value: string }>).map((o) => o.value).sort()).toEqual([
      'private',
      'public',
      'unlisted',
    ]);
  });

  it('carries the mandatory made-for-kids declaration', () => {
    expect(options()).toContain('madeForKids');
  });

  it('exposes the rest of the fields the Chat33 API accepts', () => {
    expect(options().sort()).toEqual(
      ['categoryId', 'description', 'madeForKids', 'notifySubscribers', 'privacyStatus', 'tags', 'title'].sort(),
    );
  });
});
