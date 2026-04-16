/**
 * Загрузка калибровки (kNN) для анализа.
 *
 * Важно для MVP:
 * - калибровка хранится в JSON (data/models/calibration-v0.json),
 * - на Vercel это будет read-only файл внутри деплоя,
 * - в dev можно пересобирать калибровку скриптами и перезапускать API.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import type { KnnCalibrationModel } from '@cats-screening/cv-core';

let cachedModel: KnnCalibrationModel | null = null;
let cachedMtimeMs = 0;

export type LoadCalibrationOptions = {
  /** Путь к файлу модели относительно корня репозитория. */
  modelPath?: string;
  /** Пытаться ли перечитывать файл при изменении (dev). */
  watchMtime?: boolean;
};

/**
 * Загружает модель калибровки с диска (с кешированием).
 *
 * Почему кеш:
 * - в serverless warm-start переменные модуля живут между запросами,
 * - чтение файла на каждый запрос замедляет ответ,
 * - но в dev хочется иметь возможность “пересобрал модель → обновилось”.
 */
export async function loadCalibrationModel(repoRootAbs: string, options: LoadCalibrationOptions = {}): Promise<KnnCalibrationModel> {
  const modelPath = options.modelPath ?? 'data/models/calibration-v0.json';
  const abs = path.resolve(repoRootAbs, modelPath);

  if (!options.watchMtime && cachedModel) return cachedModel;

  const stat = await fs.stat(abs).catch(() => null);
  if (!stat) {
    throw new Error(
      [
        `Не найден файл калибровки: ${modelPath}`,
        `Сначала разметь ROI и собери модель:`,
        `- npm run pipeline:calibrate`
      ].join('\n')
    );
  }

  if (cachedModel && stat.mtimeMs === cachedMtimeMs) return cachedModel;

  const text = await fs.readFile(abs, 'utf-8');
  const parsed = JSON.parse(text) as KnnCalibrationModel;

  if (parsed.version !== 1 || !Array.isArray(parsed.vectors)) {
    throw new Error(`Неверный формат calibration model: ожидали version=1 и vectors[]`);
  }

  cachedModel = parsed;
  cachedMtimeMs = stat.mtimeMs;
  return parsed;
}

