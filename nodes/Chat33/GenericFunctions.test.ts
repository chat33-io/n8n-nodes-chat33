import type { IDataObject, IExecuteFunctions, IHttpRequestOptions, JsonObject } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';
import { chat33ApiRequest, chat33UploadBuffer, listItems } from './GenericFunctions';

const NODE = {
  id: '1',
  name: 'Chat33',
  type: 'chat33',
  typeVersion: 1,
  position: [0, 0] as [number, number],
  parameters: {},
};

/**
 * What httpRequestWithAuthentication throws for a non-2xx response: a
 * NodeApiError carrying the status as httpCode and a JSON body in context.data.
 */
function apiError(status: number, body: unknown): NodeApiError {
  const err = new NodeApiError(NODE, { message: 'Request failed' } as JsonObject, {
    httpCode: String(status),
  });
  if (body && typeof body === 'object') err.context.data = body;
  return err;
}

type Handler = (options: IHttpRequestOptions) => unknown;

function makeCtx(onApi: Handler, onRaw: Handler = () => undefined) {
  const apiCalls: IHttpRequestOptions[] = [];
  const rawCalls: IHttpRequestOptions[] = [];
  const credentials = { baseUrl: 'https://chat33.io', apiKey: 'k' };
  const ctx = {
    getCredentials: jest.fn(async () => credentials),
    getNode: () => NODE,
    helpers: {
      httpRequestWithAuthentication: jest.fn(async (_cred: string, options: IHttpRequestOptions) => {
        apiCalls.push(options);
        return onApi(options);
      }),
      httpRequest: jest.fn(async (options: IHttpRequestOptions) => {
        rawCalls.push(options);
        return onRaw(options);
      }),
    },
  };
  return { ctx: ctx as unknown as IExecuteFunctions, credentials, apiCalls, rawCalls };
}

function throwing(error: unknown): Handler {
  return () => {
    throw error;
  };
}

describe('chat33ApiRequest', () => {
  it('builds the request from credentials + endpoint', async () => {
    const { ctx, apiCalls } = makeCtx(() => ({ items: [] }));
    const res = await chat33ApiRequest.call(ctx, 'GET', '/api/v1/accounts', undefined, { platform: 'tiktok' });
    expect(res).toEqual({ items: [] });
    expect(apiCalls[0]).toMatchObject({
      method: 'GET',
      url: 'https://chat33.io/api/v1/accounts',
      qs: { platform: 'tiktok' },
      json: true,
    });
  });

  it('tells Chat33 the call comes from n8n (media library shows the source)', async () => {
    const { ctx, apiCalls } = makeCtx(() => ({ ok: true }));
    await chat33ApiRequest.call(ctx, 'GET', '/api/v1/accounts');
    expect(apiCalls[0].headers).toEqual({ 'x-chat33-client': 'n8n' });
  });

  it('keeps caller headers next to the client header', async () => {
    const { ctx, apiCalls } = makeCtx(() => ({ ok: true }));
    await chat33ApiRequest.call(ctx, 'POST', '/api/v1/media/upload', undefined, undefined, {
      headers: { 'x-extra': '1' },
    });
    expect(apiCalls[0].headers).toEqual({ 'x-chat33-client': 'n8n', 'x-extra': '1' });
  });

  it('strips trailing slash from baseUrl', async () => {
    const { ctx, credentials, apiCalls } = makeCtx(() => ({ ok: true }));
    credentials.baseUrl = 'https://chat33.io/';
    await chat33ApiRequest.call(ctx, 'POST', '/api/v1/posts', { accountIds: ['a'] });
    expect(apiCalls[0].url).toBe('https://chat33.io/api/v1/posts');
    expect(apiCalls[0].body).toEqual({ accountIds: ['a'] });
  });

  it('surfaces the API error message and keeps the status', async () => {
    const { ctx } = makeCtx(
      throwing(apiError(400, { error: 'VALIDATION_ERROR', message: 'accountIds required' })),
    );
    const caught = await chat33ApiRequest.call(ctx, 'POST', '/api/v1/posts', {}).catch((e: NodeApiError) => e);
    expect(caught).toBeInstanceOf(NodeApiError);
    expect((caught as NodeApiError).message).toBe('accountIds required');
    expect((caught as NodeApiError).httpCode).toBe('400');
  });

  it('reads the status from the wrapped axios error too', async () => {
    const err = Object.assign(new Error('boom'), { cause: { response: { status: 429, data: 'slow down' } } });
    const { ctx } = makeCtx(throwing(err));
    await expect(chat33ApiRequest.call(ctx, 'GET', '/api/v1/posts')).rejects.toThrow(/Chat33 API 429: Rate limit/);
  });

  it('turns an HTML 404 response into a short readable message', async () => {
    const { ctx } = makeCtx(
      throwing(apiError(404, '<!DOCTYPE html><html><body><div id="__next">Not Found</div></body></html>')),
    );
    const caught = (await chat33ApiRequest.call(ctx, 'GET', '/api/v1/nope').catch((e: Error) => e)) as Error;
    expect(caught.message).toMatch(/Chat33 API 404/);
    expect(caught.message).toMatch(/Not found/);
    expect(caught.message).not.toMatch(/<html/i);
    expect(caught.message).not.toMatch(/__next/);
  });

  it('gives a clear message for a 401 with a non-JSON string body', async () => {
    const { ctx } = makeCtx(throwing(apiError(401, 'Unauthorized')));
    await expect(chat33ApiRequest.call(ctx, 'GET', '/api/v1/accounts')).rejects.toThrow(/Invalid API key/);
  });
});

describe('listItems', () => {
  it('unwraps { items } and passes anything else through', () => {
    expect(listItems({ items: [{ id: 'a' }] })).toEqual([{ id: 'a' }]);
    expect(listItems({ id: 'a' })).toEqual({ id: 'a' });
  });
});

describe('chat33UploadBuffer', () => {
  const presigned: IDataObject = {
    uploadUrl: 'https://vercel.com/api/blob/?pathname=posts/videos/1-a.mp4&sig=x',
    method: 'PUT',
    headers: { 'content-type': 'video/mp4' },
    type: 'video',
    contentType: 'video/mp4',
  };

  it('asks for a presigned URL then PUTs the bytes straight to storage', async () => {
    const buffer = Buffer.alloc(16352652, 7); // the size that used to 413
    const { ctx, apiCalls, rawCalls } = makeCtx(
      () => presigned,
      () =>
        JSON.stringify({
          url: 'https://store.public.blob.vercel-storage.com/posts/videos/1-a.mp4',
          contentType: 'video/mp4',
          size: 16352652,
        }),
    );

    const res = await chat33UploadBuffer.call(ctx, buffer, 'big.mp4', 'video/mp4');

    // declared the real size so the API can reject before we spend the upload
    expect(apiCalls[0]).toMatchObject({
      url: 'https://chat33.io/api/v1/media/upload-url',
      body: { filename: 'big.mp4', contentType: 'video/mp4', size: 16352652 },
    });
    // bytes go to the presigned URL, not through the Chat33 API
    expect(apiCalls).toHaveLength(1);
    expect(rawCalls[0]).toMatchObject({ method: 'PUT', url: presigned.uploadUrl, json: false });
    const headers = rawCalls[0].headers as IDataObject;
    expect(headers['content-type']).toBe('video/mp4');
    // and crucially without our API key attached
    expect(JSON.stringify(headers)).not.toMatch(/x-api-key/i);
    // nor our client header (the storage PUT is not a Chat33 API call)
    expect(JSON.stringify(headers)).not.toMatch(/x-chat33-client/i);

    expect(res).toEqual({
      url: 'https://store.public.blob.vercel-storage.com/posts/videos/1-a.mp4',
      type: 'video',
      size: 16352652,
      name: 'big.mp4',
      contentType: 'video/mp4',
    });
  });

  it('accepts an already-parsed object from the PUT', async () => {
    const { ctx } = makeCtx(
      () => presigned,
      () => ({ url: 'https://store.public.blob.vercel-storage.com/x.mp4', contentType: 'video/mp4' }),
    );
    const res = await chat33UploadBuffer.call(ctx, Buffer.alloc(10), 'x.mp4', 'video/mp4');
    expect(res.url).toBe('https://store.public.blob.vercel-storage.com/x.mp4');
  });

  it('does not swallow a real error from the presign call', async () => {
    const { ctx, rawCalls } = makeCtx(throwing(apiError(401, 'Unauthorized')));
    await expect(chat33UploadBuffer.call(ctx, Buffer.alloc(10), 'x.jpg', 'image/jpeg')).rejects.toThrow(
      /Invalid API key/,
    );
    expect(rawCalls).toHaveLength(0);
  });
});
