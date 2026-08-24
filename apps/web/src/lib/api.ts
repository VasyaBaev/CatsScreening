/**
 * Клиент для вызова backend API.
 */

import {
  type CaptureAttempt,
  type CaptureAttemptUpload,
  type CaptureTask,
  CreateCaseRequest,
  CreateCaseRequestSchema,
  type CreateCaptureAttemptRequest,
  CreateCaptureAttemptRequestSchema,
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

export async function fetchCaptureTask(code: string): Promise<CaptureTask> {
  const response = await fetch(`/api/cases/tasks/${encodeURIComponent(code.trim())}`);
  if (!response.ok) throw await responseError(response, 'Ошибка получения задания');

  const body = (await response.json()) as { task: CaptureTask };
  return body.task;
}

export async function createCaptureAttempt(
  input: CreateCaptureAttemptRequest,
): Promise<CaptureAttempt> {
  const parsed = CreateCaptureAttemptRequestSchema.parse(input);
  const response = await fetch('/api/cases/attempts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(parsed),
  });
  if (!response.ok) throw await responseError(response, 'Ошибка создания попытки');

  const body = (await response.json()) as AttemptResponse;
  return body.attempt;
}

export async function fetchCaptureAttempt(attemptId: string): Promise<CaptureAttempt> {
  const response = await fetch(`/api/cases/attempts/${encodeURIComponent(attemptId)}`);
  if (!response.ok) throw await responseError(response, 'Ошибка восстановления попытки');

  const body = (await response.json()) as AttemptResponse;
  return body.attempt;
}

export function uploadCaptureSlot(input: {
  attemptId: string;
  slotKey: string;
  file: File;
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
    request.open(
      'PUT',
      `/api/uploads/attempts/${encodeURIComponent(input.attemptId)}/slots/${encodeURIComponent(input.slotKey)}`,
    );
    request.setRequestHeader('content-type', contentType || 'application/octet-stream');
    request.setRequestHeader('x-file-name', encodeURIComponent(input.file.name));
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) input.onProgress?.(event.loaded, event.total);
    };
    request.onerror = () => reject(new Error('Сетевая ошибка загрузки оригинала'));
    request.onabort = () => reject(new Error('Загрузка отменена'));
    request.onload = () => {
      let body: unknown = {};
      try {
        body = JSON.parse(request.responseText || '{}');
      } catch {
        body = { response: request.responseText };
      }

      if (request.status < 200 || request.status >= 300) {
        reject(new Error(`Ошибка загрузки (${request.status}): ${JSON.stringify(body)}`));
        return;
      }
      resolve(body as { upload: CaptureAttemptUpload; attempt: CaptureAttempt });
    };
    request.send(input.file);
  });
}

export async function updateCaptureSlotRoi(
  attemptId: string,
  slotKey: string,
  roi: RoiShape,
): Promise<CaptureAttempt> {
  const response = await fetch(
    `/api/cases/attempts/${encodeURIComponent(attemptId)}/slots/${encodeURIComponent(slotKey)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ roi }),
    },
  );
  if (!response.ok) throw await responseError(response, 'Ошибка сохранения ROI');

  const body = (await response.json()) as AttemptResponse;
  return body.attempt;
}

export async function finalizeCaptureAttempt(
  attemptId: string,
  input: FinalizeCaptureAttemptRequest,
): Promise<CaptureAttempt> {
  const parsed = FinalizeCaptureAttemptRequestSchema.parse(input);
  const response = await fetch(`/api/cases/attempts/${encodeURIComponent(attemptId)}/finalize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(parsed),
  });
  if (!response.ok) throw await responseError(response, 'Ошибка завершения попытки');

  const body = (await response.json()) as AttemptResponse;
  return body.attempt;
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
