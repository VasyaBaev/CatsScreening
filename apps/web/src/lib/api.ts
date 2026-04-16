/**
 * Клиент для вызова backend API.
 *
 * Важно:
 * - В dev Vite проксирует `/api` на локальный backend.
 * - В prod можно будет переключить baseUrl через переменные окружения.
 */

import { CreateCaseRequest, CreateCaseRequestSchema } from '@cats-screening/shared';

export type CreateCaseResponse = {
  id: string;
  qc: { blur: boolean; glare: boolean; dark: boolean };
  result: { score: number; confidence: number };
};

/**
 * Создаёт кейс на сервере.
 */
export async function createCase(input: CreateCaseRequest): Promise<CreateCaseResponse> {
  // Рантайм-валидация на клиенте: так мы ловим “кривые” данные раньше.
  const parsed = CreateCaseRequestSchema.parse(input);

  const response = await fetch('/api/cases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(parsed)
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(`Ошибка API (${response.status}): ${JSON.stringify(body)}`);
  }

  return response.json() as Promise<CreateCaseResponse>;
}

