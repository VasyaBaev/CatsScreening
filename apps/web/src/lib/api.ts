/**
 * Клиент для вызова backend API.
 */

import {
  CreateCaseRequest,
  CreateCaseRequestSchema,
  RoiLabelDataset,
  RoiPairLabel,
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
