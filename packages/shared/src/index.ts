/**
 * Общие схемы и типы проекта CatsScreening.
 *
 * Зачем это нужно:
 * - держать единые контракты (DTO) между фронтом и бэком,
 * - валидировать входные данные на рантайме,
 * - минимизировать “дрифт” полей (pH/class/tray/light/...).
 *
 * Важно:
 * - Комментарии и документация ведутся на русском языке.
 */

import { z } from 'zod';

/**
 * Тип лотка (фон), на котором снят наполнитель.
 * Это поле напрямую влияет на шум/сложность задачи цветовой нормализации.
 */
export const TraySchema = z.enum(['white', 'gray', 'yellow']);
export type Tray = z.infer<typeof TraySchema>;

/**
 * Условия освещения.
 * В протоколе есть 3 режима: дневной (day), тёплый (3000K) и холодный (6000K).
 */
export const LightSchema = z.enum(['day', '3000K', '6000K']);
export type Light = z.infer<typeof LightSchema>;

/**
 * Минимальный набор метаданных, который “приклеивается” к кейсу и фотографиям.
 * На старте это важно для:
 * - QC (контроль качества кадра),
 * - анализа устойчивости признаков,
 * - отладки ошибок (где и почему алгоритм “сыпется”).
 */
export const CaseMetadataSchema = z.object({
  /**
   * Значение pH образца, если известно (для датасета/калибровки).
   * Для пользовательского ввода в реальном мире поле может быть пустым.
   */
  pH: z.number().min(0).max(14).nullable().default(null),

  /**
   * Класс (разметка) для обучающих/контрольных данных.
   * 0 = норма/здоровый, 1 = отклонение/риск.
   * Для пользовательских кейсов в проде будет null.
   */
  class: z.union([z.literal(0), z.literal(1)]).nullable().default(null),

  tray: TraySchema,
  light: LightSchema,

  /**
   * Локация: лаборатория или “дом/ванная”.
   * Протокол не фиксирует жесткий enum, поэтому оставляем строкой.
   */
  location: z.string().min(1),

  /**
   * Модель устройства (если известна).
   * Для пользователей можно получать из userAgent приблизительно.
   */
  device: z.string().nullable().default(null),

  /** Свободные заметки (блики, пересъём, особенности). */
  notes: z.string().nullable().default(null)
});
export type CaseMetadata = z.infer<typeof CaseMetadataSchema>;

/**
 * Идентификатор изображения в кейсе.
 * В MVP предполагаем два изображения:
 * - reference (эталон, “до реакции/до использования”)
 * - diagnostic (диагностическое, “после реакции”)
 */
export const CaseImageKindSchema = z.enum(['reference', 'diagnostic']);
export type CaseImageKind = z.infer<typeof CaseImageKindSchema>;

/**
 * Запрос на создание кейса.
 * На старте мы не “таскаем” байты изображений через этот DTO — здесь только ссылки/ключи
 * (в dev можно будет сделать upload напрямую в API, но в prod лучше загрузка в object storage).
 */
export const CreateCaseRequestSchema = z.object({
  metadata: CaseMetadataSchema,
  images: z
    .array(
      z.object({
        kind: CaseImageKindSchema,
        /**
         * Ссылка/ключ на изображение.
         * В dev это может быть локальный путь или data-идентификатор,
         * в prod — ключ object storage (например, Blob key).
         */
        uri: z.string().min(1)
      })
    )
    .min(2)
});
export type CreateCaseRequest = z.infer<typeof CreateCaseRequestSchema>;

