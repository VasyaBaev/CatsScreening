/**
 * Простая авторизация для ручной ROI-разметки.
 *
 * Что делает:
 * - защищает только служебный API `/api/roi-labels/*`;
 * - использует Basic Auth поверх HTTPS;
 * - берет логин/пароль из env, но сохраняет согласованные дефолты для текущего VPS.
 */

import { timingSafeEqual } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';

const DEFAULT_USER = 'admin';
const DEFAULT_PASSWORD = 'Ivasi!1';

function configuredUser(): string {
  return process.env.ROI_LABEL_USER?.trim() || DEFAULT_USER;
}

function configuredPassword(): string {
  return process.env.ROI_LABEL_PASSWORD || DEFAULT_PASSWORD;
}

function safeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function parseBasicAuth(header: string | undefined): { user: string; password: string } | null {
  if (!header?.startsWith('Basic ')) return null;

  try {
    const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
    const separatorIndex = decoded.indexOf(':');

    if (separatorIndex < 0) return null;

    return {
      user: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1)
    };
  } catch {
    return null;
  }
}

export function requireRoiAuth(request: FastifyRequest, reply: FastifyReply): boolean {
  const credentials = parseBasicAuth(request.headers.authorization);
  const valid =
    credentials !== null &&
    safeEqual(credentials.user, configuredUser()) &&
    safeEqual(credentials.password, configuredPassword());

  if (valid) return true;

  reply.header('www-authenticate', 'Basic realm="CatsScreening ROI", charset="UTF-8"');
  reply.code(401);
  return false;
}

export function roiAuthUser(): string {
  return configuredUser();
}

