import type {
  IExecuteFunctions,
  IHookFunctions,
  ILoadOptionsFunctions,
  IDataObject,
  IHttpRequestMethods,
  IHttpRequestOptions,
  JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

/** What the n8n request helpers throw: a NodeApiError wrapping the axios error. */
type RequestError = {
  httpCode?: string | null;
  context?: { data?: unknown };
  cause?: { response?: { status?: number; data?: unknown } };
  response?: { status?: number; data?: unknown };
};

function errorStatus(error: RequestError): number | undefined {
  const status = Number(error?.httpCode ?? error?.cause?.response?.status ?? error?.response?.status);
  return Number.isFinite(status) && status > 0 ? status : undefined;
}

function errorBody(error: RequestError): unknown {
  return error?.context?.data ?? error?.cause?.response?.data ?? error?.response?.data;
}

export async function chat33ApiRequest(
  this: IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions,
  method: IHttpRequestMethods,
  endpoint: string,
  body?: IDataObject,
  qs?: IDataObject,
  extraOptions: Partial<IHttpRequestOptions> = {},
): Promise<IDataObject> {
  const credentials = await this.getCredentials('chat33Api');
  const baseUrl = String(credentials.baseUrl || 'https://chat33.io').replace(/\/+$/, '');

  const options: IHttpRequestOptions = {
    method,
    url: `${baseUrl}${endpoint}`,
    json: true,
    ...(qs && Object.keys(qs).length ? { qs } : {}),
    ...(body && Object.keys(body).length ? { body } : {}),
    ...extraOptions,
    // Tells Chat33's media library which tool a file came from.
    headers: { 'x-chat33-client': 'n8n', ...(extraOptions.headers || {}) },
  };

  try {
    return await this.helpers.httpRequestWithAuthentication.call(this, 'chat33Api', options);
  } catch (error) {
    const status = errorStatus(error as RequestError);
    const apiBody = errorBody(error as RequestError) as IDataObject | string | undefined;
    const httpCode = status ? String(status) : undefined;

    if (apiBody && typeof apiBody === 'object' && (apiBody.message || apiBody.error)) {
      throw new NodeApiError(this.getNode(), apiBody as JsonObject, {
        message: String(apiBody.message || apiBody.error),
        httpCode,
      });
    }

    // Non-JSON bodies (an HTML 404 page, a bare "Unauthorized") would otherwise
    // be dumped into the message, so map the status to a short hint instead.
    throw new NodeApiError(this.getNode(), { message: chat33ErrorHint(status) } as JsonObject, {
      message: `Chat33 API ${status ?? 'unknown'}: ${chat33ErrorHint(status)}`,
      httpCode,
    });
  }
}

/** List endpoints return { items: [...] }; anything else passes through as is. */
export function listItems(res: IDataObject): IDataObject[] | IDataObject {
  return Array.isArray(res.items) ? (res.items as IDataObject[]) : res;
}

/**
 * Upload a local buffer to Chat33 hosting.
 *
 * Multipart POSTs to /api/v1/media/upload are capped at 4.5MB by Vercel's
 * request-body limit — the request is rejected at the edge with
 * 413 FUNCTION_PAYLOAD_TOO_LARGE before Chat33 ever sees it, so a plain
 * multipart upload silently fails for anything bigger than a small image.
 *
 * Instead we ask Chat33 for a short-lived presigned URL and PUT the bytes
 * straight to storage, which keeps the API out of the data path and raises
 * the ceiling to 500MB.
 *
 * Returns the same shape as the URL-ingest mode: { url, type, size, name,
 * contentType }.
 */
export async function chat33UploadBuffer(
  this: IExecuteFunctions,
  buffer: Buffer,
  filename: string,
  contentType: string | undefined,
): Promise<IDataObject> {
  const presigned: IDataObject = await chat33ApiRequest.call(this, 'POST', '/api/v1/media/upload-url', {
    filename,
    ...(contentType ? { contentType } : {}),
    size: buffer.byteLength,
  });

  const uploadUrl = String(presigned.uploadUrl || '');
  if (!uploadUrl) {
    throw new NodeApiError(this.getNode(), presigned as JsonObject, {
      message: 'Chat33 did not return an upload URL',
    });
  }

  // Presigned URL carries its own auth — must NOT send the Chat33 API key here.
  const raw: unknown = await this.helpers.httpRequest({
    method: 'PUT',
    url: uploadUrl,
    body: buffer,
    headers: {
      ...((presigned.headers as IDataObject) || {}),
      'content-length': String(buffer.byteLength),
    },
    json: false,
  });

  let blob: IDataObject;
  try {
    blob = typeof raw === 'string' ? JSON.parse(raw) : (raw as IDataObject);
  } catch {
    throw new NodeApiError(this.getNode(), { message: String(raw).slice(0, 300) } as JsonObject, {
      message: 'Upload succeeded but the storage response could not be parsed',
    });
  }

  return {
    url: blob.url,
    type: presigned.type,
    size: buffer.byteLength,
    name: filename,
    contentType: blob.contentType ?? presigned.contentType,
  };
}

function chat33ErrorHint(status?: number): string {
  switch (status) {
    case 401:
      return 'Invalid API key — check the Chat33 credential.';
    case 403:
      return 'API key is missing a required scope.';
    case 404:
      return 'Not found — check the resource ID (and that your Chat33 instance has this endpoint).';
    case 429:
      return 'Rate limit exceeded — try again shortly.';
    default:
      if (status && status >= 500) {
        return 'Chat33 server error — try again.';
      }
      return 'Request failed.';
  }
}
