/**
 * Общие схемы и типы проекта CatsScreening.
 *
 * Зачем это нужно:
 * - держать единые контракты (DTO) между фронтом и бэком,
 * - валидировать входные данные на рантайме,
 * - минимизировать дрейф полей pH/class/tray/light и production-like metadata.
 *
 * Важно:
 * - комментарии и документация ведутся на русском языке.
 */

import { z } from 'zod';

/**
 * Тип лотка (фон), на котором снят наполнитель.
 * Это поле влияет на шум и сложность цветовой нормализации.
 */
export const TraySchema = z.enum(['white', 'gray', 'yellow']);
export type Tray = z.infer<typeof TraySchema>;

/**
 * Условия освещения из базового протокола.
 * В production-like capture дополнительно сохраняется более свободный `condition.lightLabel`.
 */
export const LightSchema = z.enum(['day', '3000K', '6000K']);
export type Light = z.infer<typeof LightSchema>;

/**
 * Диагностический диапазон pH, который используется для квот, отчётов и будущего обучения.
 * Значение вычисляется из точного diagnostic pH, а не вводится оператором вручную.
 */
export const PhBandSchema = z.enum(['low', 'normal', 'high']);
export type PhBand = z.infer<typeof PhBandSchema>;

/**
 * Режим происхождения кейса.
 * `production_like_lab_ground_truth` означает, что пара снята как пользовательская,
 * но точный diagnostic pH известен лабораторно и может использоваться как ground truth.
 */
export const CaptureModeSchema = z.enum(['mvp_screening', 'production_like_lab_ground_truth']);
export type CaptureMode = z.infer<typeof CaptureModeSchema>;

/**
 * Условия съёмки production-like пары.
 * Эти поля фиксируют намеренное варьирование света, угла и расстояния, чтобы потом
 * можно было группировать ошибки модели и не смешивать разные причины деградации.
 */
export const ProductionLikeConditionSchema = z.object({
  lightLabel: z.string().min(1),
  angleLabel: z.string().min(1),
  distanceLabel: z.string().min(1)
});
export type ProductionLikeCondition = z.infer<typeof ProductionLikeConditionSchema>;

/**
 * Метаданные capture-сессии.
 * Время двух снимков и интервал нужны, чтобы контролировать протокол пары:
 * reference и diagnostic должны быть связаны, но не обязаны иметь одинаковую экспозицию.
 */
export const CaptureTimingSchema = z.object({
  referenceCapturedAt: z.string().min(1),
  diagnosticCapturedAt: z.string().min(1),
  captureDeltaSeconds: z.number().min(0).nullable().default(null)
});
export type CaptureTiming = z.infer<typeof CaptureTimingSchema>;

/**
 * Клиентские метаданные браузера.
 * EXIF в веб-сценариях может теряться, поэтому сохраняем минимум userAgent/viewport
 * отдельно от EXIF, чтобы у датасета оставалась диагностическая информация об устройстве.
 */
export const CaptureClientSchema = z.object({
  userAgent: z.string().nullable().default(null),
  viewport: z
    .object({
      width: z.number().int().positive(),
      height: z.number().int().positive()
    })
    .nullable()
    .default(null),
  exif: z.record(z.unknown()).optional()
});
export type CaptureClient = z.infer<typeof CaptureClientSchema>;

/**
 * ROI прямоугольник для анализа (0..1).
 * Используется в полуручном режиме и в дальнейшем может вычисляться автоматически.
 */
export const RoiRectSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().min(0).max(1),
    h: z.number().min(0).max(1)
  })
  .refine((r) => r.w > 0 && r.h > 0, { message: 'ROI: w/h должны быть > 0' })
  .refine((r) => r.x + r.w <= 1 && r.y + r.h <= 1, {
    message: 'ROI выходит за границы изображения (x+w или y+h > 1)'
  });
export type RoiRect = z.infer<typeof RoiRectSchema>;

/**
 * Точка ручной ROI-разметки в относительных координатах изображения.
 * Храним значения в диапазоне 0..1, чтобы одна и та же разметка применялась
 * к превью, web-копии и исходному файлу без зависимости от размера картинки.
 */
export const RoiPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1)
});
export type RoiPoint = z.infer<typeof RoiPointSchema>;

/**
 * Универсальная ROI-маска для ручной разметки наполнителя.
 * `rect` нужен для быстрого production-like capture, `polygon` нужен для
 * лабораторных кадров, где прямоугольник захватывает бортики, плитку или фон.
 */
const RoiShapeBaseSchema = z.object({
  source: z.enum(['manual', 'fixed', 'auto']).default('manual'),
  updatedAt: z.string().min(1).optional()
});

export const RoiShapeSchema = z.discriminatedUnion('shape', [
  RoiShapeBaseSchema.extend({
    shape: z.literal('rect'),
    rect: RoiRectSchema
  }),
  RoiShapeBaseSchema.extend({
    shape: z.literal('polygon'),
    points: z.array(RoiPointSchema).min(3).max(64)
  })
]);
export type RoiShape = z.infer<typeof RoiShapeSchema>;

/**
 * ROI для пары reference + diagnostic. Области хранятся отдельно, потому что
 * кадры одной пары часто немного сдвинуты относительно друг друга.
 */
export const CaseRoiSetSchema = z.object({
  reference: RoiShapeSchema.optional(),
  diagnostic: RoiShapeSchema.optional()
});
export type CaseRoiSet = z.infer<typeof CaseRoiSetSchema>;

export const RoiLabelStatusSchema = z.enum(['draft', 'reviewed', 'needs_fix', 'unusable']);
export type RoiLabelStatus = z.infer<typeof RoiLabelStatusSchema>;

/**
 * Ручная разметка одной pH-пары из датасета. Этот контракт используется
 * вкладкой разметки, API-хранилищем и будущим пересчетом feature-cache.
 */
export const RoiPairLabelSchema = z.object({
  pairId: z.string().min(1),
  dataset: z.string().min(1).default('v5-v8'),
  sourceVersion: z.string().min(1).optional(),
  status: RoiLabelStatusSchema.default('draft'),
  rois: CaseRoiSetSchema,
  note: z.string().nullable().default(null),
  updatedAt: z.string().min(1),
  updatedBy: z.string().nullable().default(null)
});
export type RoiPairLabel = z.infer<typeof RoiPairLabelSchema>;

export const RoiLabelDatasetSchema = z.object({
  version: z.literal(1),
  dataset: z.string().min(1),
  updatedAt: z.string().nullable(),
  labels: z.record(RoiPairLabelSchema).default({})
});
export type RoiLabelDataset = z.infer<typeof RoiLabelDatasetSchema>;

export const SaveRoiLabelRequestSchema = z.object({
  pairId: z.string().min(1),
  dataset: z.string().min(1).default('v5-v8'),
  sourceVersion: z.string().min(1).optional(),
  status: RoiLabelStatusSchema.default('draft'),
  rois: CaseRoiSetSchema,
  note: z.string().nullable().default(null),
  updatedBy: z.string().nullable().default(null)
});
export type SaveRoiLabelRequest = z.infer<typeof SaveRoiLabelRequestSchema>;

/**
 * Минимальный набор метаданных, который приклеивается к кейсу и фотографиям.
 * На старте это важно для QC, анализа устойчивости признаков и отладки ошибок.
 */
export const CaseMetadataSchema = z.object({
  /**
   * Значение pH образца, если известно.
   * Для production-like pilot это будет diagnostic pH, а reference pH хранится отдельно.
   */
  pH: z.number().min(0).max(14).nullable().default(null),

  /**
   * Класс для обучения/контроля: 0 = норма, 1 = отклонение/риск.
   * Для реальных пользовательских кейсов в проде значение будет null.
   */
  class: z.union([z.literal(0), z.literal(1)]).nullable().default(null),

  tray: TraySchema,
  light: LightSchema,

  /**
   * Локация: лаборатория, ванная, кухня или другой production-like контекст.
   */
  location: z.string().min(1),

  /**
   * Модель устройства, если известна оператору или извлечена из userAgent/EXIF.
   */
  device: z.string().nullable().default(null),

  /** Свободные заметки оператора. */
  notes: z.string().nullable().default(null),

  /** Серия сбора данных: например `production-like-001`. */
  series: z.string().min(1).optional(),

  /** Идентификатор пары reference + diagnostic, общий для UI, API, storage и export. */
  pairId: z.string().min(1).optional(),

  /** Режим получения данных: MVP-скрининг или production-like ground truth pilot. */
  captureMode: CaptureModeSchema.optional(),

  /** Оператор/съёмочная смена для grouped holdout и поиска систематических ошибок. */
  operatorId: z.string().nullable().optional(),

  /** pH reference-снимка. Храним отдельно от diagnostic pH, потому что роли разные. */
  referencePh: z.number().min(0).max(14).nullable().optional(),

  /** Точный diagnostic pH, который является ground truth для обучения и валидации. */
  diagnosticPh: z.number().min(0).max(14).nullable().optional(),

  /** Диапазон diagnostic pH: low/normal/high. Вычисляется из `diagnosticPh`. */
  diagnosticBand: PhBandSchema.nullable().optional(),

  /** Намеренно заданные условия production-like съёмки. */
  condition: ProductionLikeConditionSchema.optional(),

  /** Временные метки пары и интервал между снимками. */
  capture: CaptureTimingSchema.optional(),

  /** Ручные ROI-области reference/diagnostic, по которым нужно считать цветовые признаки. */
  rois: CaseRoiSetSchema.optional(),

  /** Метаданные браузера/устройства, которые не всегда доступны через EXIF. */
  client: CaptureClientSchema.optional()
});
export type CaseMetadata = z.infer<typeof CaseMetadataSchema>;

/**
 * Идентификатор изображения в кейсе.
 * В MVP предполагаем два изображения: reference и diagnostic.
 */
export const CaseImageKindSchema = z.enum(['reference', 'diagnostic']);
export type CaseImageKind = z.infer<typeof CaseImageKindSchema>;

/**
 * Запрос на создание кейса.
 * Изображения передаются как URI/ключи object storage, а не как байты.
 */
export const CreateCaseRequestSchema = z.object({
  metadata: CaseMetadataSchema,
  images: z
    .array(
      z.object({
        kind: CaseImageKindSchema,
        /**
         * Ссылка/ключ на изображение.
         * В dev это может быть local URI, в prod — object storage key.
         */
        uri: z.string().min(1)
      })
    )
    .min(2)
});
export type CreateCaseRequest = z.infer<typeof CreateCaseRequestSchema>;

/**
 * Запрос на загрузку одного изображения capture-пары.
 * В локальном dev-режиме API принимает base64 и пишет файл в `apps/api/storage`.
 * В production этот же контракт можно использовать для object storage adapter.
 */
export const UploadImageRequestSchema = z.object({
  pairId: z.string().min(1),
  kind: CaseImageKindSchema,
  fileName: z.string().min(1).max(255),
  contentType: z.string().regex(/^image\/(jpeg|png|webp)$/),
  dataBase64: z.string().min(1)
});
export type UploadImageRequest = z.infer<typeof UploadImageRequestSchema>;

/**
 * Ответ upload endpoint.
 * `uri` сохраняется в `CaseImage.uri`, а `publicUrl` используется для локальной отладки.
 */
export const UploadImageResponseSchema = z.object({
  uri: z.string().min(1),
  publicUrl: z.string().nullable(),
  storageProvider: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  contentType: z.string().min(1)
});
export type UploadImageResponse = z.infer<typeof UploadImageResponseSchema>;

/**
 * Запрос на анализ пары reference + diagnostic по ROI.
 * В production вместо локальных путей должны использоваться ключи object storage.
 */
export const AnalyzeRequestSchema = z.object({
  referenceUri: z.string().min(1),
  diagnosticUri: z.string().min(1),
  roi: RoiRectSchema,
  debug: z.boolean().optional().default(false)
});
export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;

/**
 * Определяет band по точному pH diagnostic-снимка.
 * Нормальное окно зафиксировано как 5.8..6.4, чтобы UI, API и pipeline одинаково
 * считали квоты и классы для текущего production-like пилота.
 */
export function derivePhBand(ph: number): PhBand {
  if (ph < 5.8) return 'low';
  if (ph > 6.4) return 'high';
  return 'normal';
}
