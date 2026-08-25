/**
 * Клиент для вызова backend API.
 */

import {
  type CaptureAttempt,
  type CaptureAttemptUpload,
  type CaptureContext,
  CaptureContextSchema,
  type CaptureContextQuery,
  type CreateCaptureReplacementRequest,
  CreateCaptureReplacementRequestSchema,
  type CreatePolicyCaptureAttemptRequest,
  CreatePolicyCaptureAttemptRequestSchema,
  CreateCaseRequest,
  CreateCaseRequestSchema,
  type FinalizeCaptureAttemptRequest,
  FinalizeCaptureAttemptRequestSchema,
  RoiLabelDataset,
  RoiPairLabel,
  type RoiShape,
  SaveRoiLabelRequest,
  SaveRoiLabelRequestSchema,
  UploadImageRequest,
  UploadImageRequestSchema,
  UploadImageResponse,
} from '@cats-screening/shared';

export type CreateCaseResponse = {
  id: string;
  storage?: string;
  qc: { blur: boolean; glare: boolean; dark: boolean };
  result: { score: number; confidence: number };
};

export type RoiAuthCredentials = {
  username: string;
  password: string;
};

type AttemptResponse = { attempt: CaptureAttempt };

async function responseError(response: Response, label: string): Promise<Error> {
  const body = await response.json().catch(() => ({}));
  return new Error(`${label} (${response.status}): ${JSON.stringify(body)}`);
}

function roiAuthHeaders(auth: RoiAuthCredentials): HeadersInit {
  return {
    authorization: `Basic ${window.btoa(`${auth.username}:${auth.password}`)}`,
  };
}

export async function uploadImage(input: UploadImageRequest): Promise<UploadImageResponse> {
  const parsed = UploadImageRequestSchema.parse(input);

  const response = await fetch('/api/uploads/image', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(parsed),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(`Ошибка upload API (${response.status}): ${JSON.stringify(body)}`);
  }

  return response.json() as Promise<UploadImageResponse>;
}

export async function createCase(input: CreateCaseRequest): Promise<CreateCaseResponse> {
  const parsed = CreateCaseRequestSchema.parse(input);

  const response = await fetch('/api/cases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(parsed),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(`Ошибка API (${response.status}): ${JSON.stringify(body)}`);
  }

  return response.json() as Promise<CreateCaseResponse>;
}

export async function fetchCaptureContext(
  query: CaptureContextQuery = {},
  signal?: AbortSignal,
): Promise<CaptureContext> {
  const parameters = new URLSearchParams();
  if (query.deviceRole) parameters.set('deviceRole', query.deviceRole);
  if (query.specimenMode) parameters.set('specimenMode', query.specimenMode);
  if (query.sourcePh !== undefined) parameters.set('sourcePh', String(query.sourcePh));
  const suffix = parameters.size > 0 ? `?${parameters.toString()}` : '';
  const response = await fetch(`/api/cases/context${suffix}`, { signal });
  if (!response.ok) throw await responseError(response, 'Ошибка получения Capture context');
  return CaptureContextSchema.parse(await response.json());
}

export async function createCaptureAttempt(
  input: CreatePolicyCaptureAttemptRequest,
  clientRequestId: string,
  signal?: AbortSignal,
): Promise<CaptureAttempt> {
  const parsed = CreatePolicyCaptureAttemptRequestSchema.parse(input);
  const response = await fetch('/api/cases/attempts', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-capture-request-id': clientRequestId,
    },
    body: JSON.stringify(parsed),
    signal,
  });
  if (!response.ok) throw await responseError(response, 'Ошибка создания попытки');

  const body = (await response.json()) as AttemptResponse;
  return body.attempt;
}

export async function fetchCaptureAttemptByClientRequestId(
  clientRequestId: string,
  signal?: AbortSignal,
): Promise<CaptureAttempt> {
  const response = await fetch(
    `/api/cases/attempts/by-client-request/${encodeURIComponent(clientRequestId)}`,
    { signal },
  );
  if (!response.ok) throw await responseError(response, 'Ошибка восстановления создания пары');

  const body = (await response.json()) as AttemptResponse;
  return body.attempt;
}

export async function fetchCaptureAttempt(
  attemptId: string,
  signal?: AbortSignal,
): Promise<CaptureAttempt> {
  const response = await fetch(`/api/cases/attempts/${encodeURIComponent(attemptId)}`, { signal });
  if (!response.ok) throw await responseError(response, 'Ошибка восстановления попытки');

  const body = (await response.json()) as AttemptResponse;
  return body.attempt;
}

export function uploadCaptureSlot(input: {
  attemptId: string;
  slotKey: string;
  file: File;
  signal?: AbortSignal;
  onProgress?: (loaded: number, total: number) => void;
}): Promise<{ upload: CaptureAttemptUpload; attempt: CaptureAttempt }> {
  return new Promise((resolve, reject) => {
    const extension = input.file.name.split('.').pop()?.toLowerCase();
    const extensionTypes: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      heic: 'image/heic',
      heif: 'image/heif',
    };
    const declaredType =
      input.file.type.toLowerCase() === 'image/jpg' ? 'image/jpeg' : input.file.type;
    const contentType = declaredType || (extension ? extensionTypes[extension] : undefined);
    const request = new XMLHttpRequest();
    let settled = false;
    const cleanup = () => input.signal?.removeEventListener('abort', abortRequest);
    const fail = (reason: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(reason);
    };
    const succeed = (value: { upload: CaptureAttemptUpload; attempt: CaptureAttempt }) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const abortRequest = () => request.abort();
    if (input.signal?.aborted) {
      fail(new Error('Загрузка отменена'));
      return;
    }
    input.signal?.addEventListener('abort', abortRequest, { once: true });
    request.open(
      'PUT',
      `/api/uploads/attempts/${encodeURIComponent(input.attemptId)}/slots/${encodeURIComponent(input.slotKey)}`,
    );
    request.setRequestHeader('content-type', contentType || 'application/octet-stream');
    request.setRequestHeader('x-file-name', encodeURIComponent(input.file.name));
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) input.onProgress?.(event.loaded, event.total);
    };
    request.onerror = () => fail(new Error('Сетевая ошибка загрузки оригинала'));
    request.onabort = () => fail(new Error('Загрузка отменена'));
    request.onload = () => {
      let body: unknown = {};
      try {
        body = JSON.parse(request.responseText || '{}');
      } catch {
        body = { response: request.responseText };
      }

      if (request.status < 200 || request.status >= 300) {
        fail(new Error(`Ошибка загрузки (${request.status}): ${JSON.stringify(body)}`));
        return;
      }
      succeed(body as { upload: CaptureAttemptUpload; attempt: CaptureAttempt });
    };
    request.send(input.file);
  });
}

export async function updateCaptureSlotRoi(
  attemptId: string,
  slotKey: string,
  roi: RoiShape,
  signal?: AbortSignal,
): Promise<CaptureAttempt> {
  const response = await fetch(
    `/api/cases/attempts/${encodeURIComponent(attemptId)}/slots/${encodeURIComponent(slotKey)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ roi }),
      signal,
    },
  );
  if (!response.ok) throw await responseError(response, 'Ошибка сохранения ROI');

  const body = (await response.json()) as AttemptResponse;
  return body.attempt;
}

export async function finalizeCaptureAttempt(
  attemptId: string,
  input: FinalizeCaptureAttemptRequest,
  signal?: AbortSignal,
): Promise<CaptureAttempt> {
  const parsed = FinalizeCaptureAttemptRequestSchema.parse(input);
  const response = await fetch(`/api/cases/attempts/${encodeURIComponent(attemptId)}/finalize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(parsed),
    signal,
  });
  if (!response.ok) throw await responseError(response, 'Ошибка завершения попытки');

  const body = (await response.json()) as AttemptResponse;
  return body.attempt;
}

export async function startCaptureReaction(
  attemptId: string,
  signal?: AbortSignal,
): Promise<CaptureAttempt> {
  const response = await fetch(
    `/api/cases/attempts/${encodeURIComponent(attemptId)}/reaction/start`,
    { method: 'POST', signal },
  );
  if (!response.ok) throw await responseError(response, 'Ошибка запуска реакции');

  const body = (await response.json()) as AttemptResponse;
  return body.attempt;
}

export async function replaceCaptureAttempt(
  attemptId: string,
  input: CreateCaptureReplacementRequest,
  signal?: AbortSignal,
): Promise<{ previousAttempt: CaptureAttempt; replacementAttempt: CaptureAttempt }> {
  const parsed = CreateCaptureReplacementRequestSchema.parse(input);
  const response = await fetch(`/api/cases/attempts/${encodeURIComponent(attemptId)}/replacement`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(parsed),
    signal,
  });
  if (!response.ok) throw await responseError(response, 'Ошибка пересъёмки');

  return response.json() as Promise<{
    previousAttempt: CaptureAttempt;
    replacementAttempt: CaptureAttempt;
  }>;
}

export async function checkRoiAuth(auth: RoiAuthCredentials): Promise<{ ok: true; user: string }> {
  const response = await fetch('/api/roi-labels/auth/check', {
    headers: roiAuthHeaders(auth),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(`Ошибка авторизации ROI (${response.status}): ${JSON.stringify(body)}`);
  }

  return response.json() as Promise<{ ok: true; user: string }>;
}

export async function fetchRoiLabels(auth: RoiAuthCredentials): Promise<RoiLabelDataset> {
  const response = await fetch('/api/roi-labels/v5-v8', {
    headers: roiAuthHeaders(auth),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(`Ошибка ROI labels API (${response.status}): ${JSON.stringify(body)}`);
  }

  return response.json() as Promise<RoiLabelDataset>;
}

export async function fetchV9RoiCases<T = { pairs: unknown[] }>(
  auth: RoiAuthCredentials,
): Promise<T> {
  const response = await fetch('/api/roi-labels/v9/cases', {
    headers: roiAuthHeaders(auth),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(`Ошибка V9 ROI API (${response.status}): ${JSON.stringify(body)}`);
  }

  return response.json() as Promise<T>;
}

export async function exportRoiLabels(auth: RoiAuthCredentials): Promise<Blob> {
  const response = await fetch('/api/roi-labels/v5-v8/export.json', {
    headers: roiAuthHeaders(auth),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(`Ошибка экспорта ROI (${response.status}): ${JSON.stringify(body)}`);
  }

  return response.blob();
}

export async function saveRoiLabel(
  input: SaveRoiLabelRequest,
  auth: RoiAuthCredentials,
): Promise<RoiPairLabel> {
  const parsed = SaveRoiLabelRequestSchema.parse(input);

  const response = await fetch(`/api/roi-labels/v5-v8/${encodeURIComponent(parsed.pairId)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...roiAuthHeaders(auth) },
    body: JSON.stringify(parsed),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(`Ошибка сохранения ROI (${response.status}): ${JSON.stringify(body)}`);
  }

  const body = (await response.json()) as { label: RoiPairLabel };
  return body.label;
}
