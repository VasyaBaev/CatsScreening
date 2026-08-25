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
  distanceLabel: z.string().min(1),
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
  captureDeltaSeconds: z.number().min(0).nullable().default(null),
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
      height: z.number().int().positive(),
    })
    .nullable()
    .default(null),
  exif: z.record(z.unknown()).optional(),
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
    h: z.number().min(0).max(1),
  })
  .refine((r) => r.w > 0 && r.h > 0, { message: 'ROI: w/h должны быть > 0' })
  .refine((r) => r.x + r.w <= 1 && r.y + r.h <= 1, {
    message: 'ROI выходит за границы изображения (x+w или y+h > 1)',
  });
export type RoiRect = z.infer<typeof RoiRectSchema>;

/**
 * Точка ручной ROI-разметки в относительных координатах изображения.
 * Храним значения в диапазоне 0..1, чтобы одна и та же разметка применялась
 * к превью, web-копии и исходному файлу без зависимости от размера картинки.
 */
export const RoiPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});
export type RoiPoint = z.infer<typeof RoiPointSchema>;

/**
 * Универсальная ROI-маска для ручной разметки наполнителя.
 * `rect` нужен для быстрого production-like capture, `polygon` нужен для
 * лабораторных кадров, где прямоугольник захватывает бортики, плитку или фон.
 */
const RoiShapeBaseSchema = z.object({
  source: z.enum(['manual', 'fixed', 'auto']).default('manual'),
  updatedAt: z.string().min(1).optional(),
});

export const RoiShapeSchema = z.discriminatedUnion('shape', [
  RoiShapeBaseSchema.extend({
    shape: z.literal('rect'),
    rect: RoiRectSchema,
  }),
  RoiShapeBaseSchema.extend({
    shape: z.literal('polygon'),
    points: z.array(RoiPointSchema).min(3).max(64),
  }),
]);
export type RoiShape = z.infer<typeof RoiShapeSchema>;

/**
 * ROI для пары reference + diagnostic. Области хранятся отдельно, потому что
 * кадры одной пары часто немного сдвинуты относительно друг друга.
 */
export const CaseRoiSetSchema = z.object({
  reference: RoiShapeSchema.optional(),
  diagnostic: RoiShapeSchema.optional(),
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
  updatedBy: z.string().nullable().default(null),
});
export type RoiPairLabel = z.infer<typeof RoiPairLabelSchema>;

export const RoiLabelDatasetSchema = z.object({
  version: z.literal(1),
  dataset: z.string().min(1),
  updatedAt: z.string().nullable(),
  labels: z.record(RoiPairLabelSchema).default({}),
});
export type RoiLabelDataset = z.infer<typeof RoiLabelDatasetSchema>;

export const SaveRoiLabelRequestSchema = z.object({
  pairId: z.string().min(1),
  dataset: z.string().min(1).default('v5-v8'),
  sourceVersion: z.string().min(1).optional(),
  status: RoiLabelStatusSchema.default('draft'),
  rois: CaseRoiSetSchema,
  note: z.string().nullable().default(null),
  updatedBy: z.string().nullable().default(null),
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
  class: z
    .union([z.literal(0), z.literal(1)])
    .nullable()
    .default(null),

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
  client: CaptureClientSchema.optional(),
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
        uri: z.string().min(1),
      }),
    )
    .min(2),
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
  dataBase64: z.string().min(1),
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
  contentType: z.string().min(1),
});
export type UploadImageResponse = z.infer<typeof UploadImageResponseSchema>;

export const CaptureTaskTypeSchema = z.enum(['reacted_specimen', 'blank_qc']);
export type CaptureTaskType = z.infer<typeof CaptureTaskTypeSchema>;

export const CapturePolicyStatusSchema = z.enum(['draft', 'active']);
export type CapturePolicyStatus = z.infer<typeof CapturePolicyStatusSchema>;

export const CaptureSpecimenModeSchema = z.enum(['independent', 'shared']);
export type CaptureSpecimenMode = z.infer<typeof CaptureSpecimenModeSchema>;

export const CapturePolicyOptionSchema = z.object({
  value: z.string().min(1).max(120),
  label: z.string().min(1).max(160),
});
export type CapturePolicyOption = z.infer<typeof CapturePolicyOptionSchema>;

export const CapturePolicyDeviceRoleSchema = z.object({
  value: z.string().regex(/^[a-z0-9_-]+$/),
  label: z.string().min(1).max(160),
});
export type CapturePolicyDeviceRole = z.infer<typeof CapturePolicyDeviceRoleSchema>;

export const CapturePolicyQuotaSchema = z.object({
  sourcePh: z.number().min(0).max(14),
  deviceRole: z.string().regex(/^[a-z0-9_-]+$/),
  specimenMode: CaptureSpecimenModeSchema,
  target: z.number().int().positive(),
});
export type CapturePolicyQuota = z.infer<typeof CapturePolicyQuotaSchema>;

export const CapturePolicySchema = z
  .object({
    policyId: z.string().min(1).max(120),
    version: z.string().min(1).max(80),
    seriesId: z.string().min(1).max(120),
    status: CapturePolicyStatusSchema,
    referencePh: z.number().min(0).max(14),
    sourcePhValues: z.array(z.number().min(0).max(14)),
    deviceRoles: z.array(CapturePolicyDeviceRoleSchema),
    specimenModes: z.array(CaptureSpecimenModeSchema),
    quotas: z.array(CapturePolicyQuotaSchema),
    conditions: z.object({
      lights: z.array(CapturePolicyOptionSchema),
      angles: z.array(CapturePolicyOptionSchema),
      distances: z.array(CapturePolicyOptionSchema),
    }),
    requirePolygonRoi: z.boolean(),
    instruction: z.string().min(1).max(2000),
    reactionTargetSeconds: z.number().int().positive().nullable(),
    reactionToleranceSeconds: z.number().int().nonnegative().nullable(),
    showFinalMixturePh: z.boolean(),
    requireFinalMixturePh: z.boolean(),
  })
  .superRefine((policy, context) => {
    const sourceValues = new Set(policy.sourcePhValues);
    const roleValues = new Set(policy.deviceRoles.map((role) => role.value));
    const modeValues = new Set(policy.specimenModes);

    if (sourceValues.size !== policy.sourcePhValues.length) {
      context.addIssue({
        code: 'custom',
        path: ['sourcePhValues'],
        message: 'pH должны быть уникальны',
      });
    }
    if (roleValues.size !== policy.deviceRoles.length) {
      context.addIssue({
        code: 'custom',
        path: ['deviceRoles'],
        message: 'Device roles должны быть уникальны',
      });
    }
    if (modeValues.size !== policy.specimenModes.length) {
      context.addIssue({
        code: 'custom',
        path: ['specimenModes'],
        message: 'Specimen modes должны быть уникальны',
      });
    }

    const timingIsComplete =
      (policy.reactionTargetSeconds === null && policy.reactionToleranceSeconds === null) ||
      (policy.reactionTargetSeconds !== null && policy.reactionToleranceSeconds !== null);
    if (!timingIsComplete) {
      context.addIssue({
        code: 'custom',
        path: ['reactionTargetSeconds'],
        message: 'Target и tolerance должны быть одновременно заданы или null',
      });
    }
    if (policy.requireFinalMixturePh && !policy.showFinalMixturePh) {
      context.addIssue({
        code: 'custom',
        path: ['requireFinalMixturePh'],
        message: 'Скрытый finalMixturePh нельзя сделать обязательным',
      });
    }

    const quotaKeys = new Set<string>();
    policy.quotas.forEach((quota, index) => {
      if (!sourceValues.has(quota.sourcePh)) {
        context.addIssue({
          code: 'custom',
          path: ['quotas', index, 'sourcePh'],
          message: 'Quota ссылается на необъявленный source pH',
        });
      }
      if (!roleValues.has(quota.deviceRole)) {
        context.addIssue({
          code: 'custom',
          path: ['quotas', index, 'deviceRole'],
          message: 'Quota ссылается на необъявленный device role',
        });
      }
      if (!modeValues.has(quota.specimenMode)) {
        context.addIssue({
          code: 'custom',
          path: ['quotas', index, 'specimenMode'],
          message: 'Quota ссылается на необъявленный specimen mode',
        });
      }
      const key = `${quota.sourcePh}:${quota.deviceRole}:${quota.specimenMode}`;
      if (quotaKeys.has(key)) {
        context.addIssue({
          code: 'custom',
          path: ['quotas', index],
          message: 'Quota cell должна быть уникальной',
        });
      }
      quotaKeys.add(key);
    });

    if (policy.status === 'active') {
      const requiredCollections = [
        ['sourcePhValues', policy.sourcePhValues],
        ['deviceRoles', policy.deviceRoles],
        ['specimenModes', policy.specimenModes],
        ['quotas', policy.quotas],
        ['conditions', policy.conditions.lights],
        ['conditions', policy.conditions.angles],
        ['conditions', policy.conditions.distances],
      ] as const;
      for (const [path, values] of requiredCollections) {
        if (values.length === 0) {
          context.addIssue({
            code: 'custom',
            path: [path],
            message: 'Active policy не может быть пустой',
          });
        }
      }
    }
  });
export type CapturePolicy = z.infer<typeof CapturePolicySchema>;

export const CaptureQuotaCellSummarySchema = CapturePolicyQuotaSchema.extend({
  actual: z.number().int().nonnegative(),
  reserved: z.number().int().nonnegative(),
  available: z.number().int().nonnegative(),
});
export type CaptureQuotaCellSummary = z.infer<typeof CaptureQuotaCellSummarySchema>;

export const CaptureQuotaSummarySchema = z.object({
  policyId: z.string().min(1),
  policyVersion: z.string().min(1),
  seriesId: z.string().min(1),
  target: z.number().int().nonnegative(),
  actual: z.number().int().nonnegative(),
  reserved: z.number().int().nonnegative(),
  available: z.number().int().nonnegative(),
  cells: z.array(CaptureQuotaCellSummarySchema),
});
export type CaptureQuotaSummary = z.infer<typeof CaptureQuotaSummarySchema>;

export const CaptureSharedSpecimenSchema = z.object({
  specimenId: z.string().uuid(),
  displayLabel: z.string().min(1),
  sourcePh: z.number().min(0).max(14),
  completedDeviceRoles: z.array(z.string()),
  reservedDeviceRoles: z.array(z.string()),
  missingDeviceRoles: z.array(z.string()),
});
export type CaptureSharedSpecimen = z.infer<typeof CaptureSharedSpecimenSchema>;

export const CaptureContextQuerySchema = z.object({
  deviceRole: z.string().optional(),
  specimenMode: CaptureSpecimenModeSchema.optional(),
  sourcePh: z.coerce.number().min(0).max(14).optional(),
});
export type CaptureContextQuery = z.infer<typeof CaptureContextQuerySchema>;

export const CaptureContextSchema = z.object({
  policy: CapturePolicySchema,
  quotaSummary: CaptureQuotaSummarySchema,
  availableSharedSpecimens: z.array(CaptureSharedSpecimenSchema),
});
export type CaptureContext = z.infer<typeof CaptureContextSchema>;

export const CaptureSlotKindSchema = z.enum(['reference', 'diagnostic', 'qc']);
export type CaptureSlotKind = z.infer<typeof CaptureSlotKindSchema>;

export const CaptureTaskSlotSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9_-]+$/),
    kind: CaptureSlotKindSchema,
    label: z.string().min(1),
    required: z.boolean(),
    targetSeconds: z.number().int().positive().nullable().default(null),
    toleranceSeconds: z.number().int().nonnegative().nullable().default(null),
  })
  .refine(
    (slot) =>
      (slot.targetSeconds === null && slot.toleranceSeconds === null) ||
      (slot.targetSeconds !== null && slot.toleranceSeconds !== null),
    { message: 'Timed slot должен одновременно задавать targetSeconds и toleranceSeconds' },
  );
export type CaptureTaskSlot = z.infer<typeof CaptureTaskSlotSchema>;

export const CaptureTaskSchema = z.object({
  code: z.string().min(2).max(80),
  taskType: CaptureTaskTypeSchema,
  specimenId: z.string().min(1).max(80),
  sourcePh: z.number().min(0).max(14),
  slots: z.array(CaptureTaskSlotSchema).min(1),
});
export type CaptureTask = z.infer<typeof CaptureTaskSchema>;

export const CaptureAttemptUploadSchema = z.object({
  slotKey: z.string().min(1),
  kind: CaptureSlotKindSchema,
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1).max(100),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  uri: z.string().min(1),
  publicUrl: z.string().nullable(),
  savedAt: z.string().min(1),
  roi: RoiShapeSchema.nullable().default(null),
});
export type CaptureAttemptUpload = z.infer<typeof CaptureAttemptUploadSchema>;

export const CaptureFinalizeResultSchema = z.object({
  caseId: z.string().uuid(),
  finalizedAt: z.string().min(1),
  included: z.boolean(),
  exclusionReason: z.string().nullable(),
});
export type CaptureFinalizeResult = z.infer<typeof CaptureFinalizeResultSchema>;

export const CaptureAttemptSchema = z.object({
  id: z.string().uuid(),
  task: CaptureTaskSchema,
  status: z.enum(['active', 'finalized', 'abandoned', 'superseded']),
  operatorId: z.string().min(1).max(120),
  device: z.string().min(1).max(160),
  series: z.string().min(1).max(120),
  condition: ProductionLikeConditionSchema,
  reactionStartedAt: z.string().min(1).nullable(),
  diagnosticSavedAt: z.string().min(1).nullable().default(null),
  reactionElapsedSec: z.number().nonnegative().nullable().default(null),
  finalMixturePh: z.number().min(0).max(14).nullable(),
  uploads: z.record(CaptureAttemptUploadSchema),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  result: CaptureFinalizeResultSchema.nullable(),
  policySnapshot: CapturePolicySchema.optional(),
  pairId: z.string().uuid().optional(),
  displayLabel: z.string().min(1).optional(),
  deviceRole: z.string().optional(),
  specimenMode: CaptureSpecimenModeSchema.optional(),
  referencePh: z.number().min(0).max(14).optional(),
  replacesAttemptId: z.string().uuid().optional(),
  replacedByAttemptId: z.string().uuid().optional(),
});
export type CaptureAttempt = z.infer<typeof CaptureAttemptSchema>;

export const CreatePolicyCaptureAttemptRequestSchema = z.object({
  sourcePh: z.number().min(0).max(14),
  referencePh: z.number().min(0).max(14),
  deviceRole: z.string().regex(/^[a-z0-9_-]+$/),
  specimenMode: CaptureSpecimenModeSchema,
  sharedSpecimenId: z.string().uuid().nullable().default(null),
  operatorId: z.string().min(1).max(120),
  lightLabel: z.string().min(1).max(120),
  angleLabel: z.string().min(1).max(120),
  distanceLabel: z.string().min(1).max(120),
});
export type CreatePolicyCaptureAttemptRequest = z.infer<
  typeof CreatePolicyCaptureAttemptRequestSchema
>;

export const CaptureReplacementSpecimenChoiceSchema = z.enum(['same', 'new']);
export type CaptureReplacementSpecimenChoice = z.infer<
  typeof CaptureReplacementSpecimenChoiceSchema
>;

export const CreateCaptureReplacementRequestSchema = CreatePolicyCaptureAttemptRequestSchema.extend(
  {
    specimenChoice: CaptureReplacementSpecimenChoiceSchema,
  },
);
export type CreateCaptureReplacementRequest = z.infer<typeof CreateCaptureReplacementRequestSchema>;

export const CreateCaptureAttemptRequestSchema = z.object({
  taskCode: z.string().min(2).max(24),
  operatorId: z.string().min(1).max(120),
  device: z.string().min(1).max(160),
  series: z.string().min(1).max(120),
  lightLabel: z.string().min(1).max(120),
  angleLabel: z.string().min(1).max(120),
  distanceLabel: z.string().min(1).max(120),
});
export type CreateCaptureAttemptRequest = z.infer<typeof CreateCaptureAttemptRequestSchema>;

export const UpdateCaptureSlotRequestSchema = z.object({
  roi: RoiShapeSchema,
});
export type UpdateCaptureSlotRequest = z.infer<typeof UpdateCaptureSlotRequestSchema>;

export const FinalizeCaptureAttemptRequestSchema = z.object({
  finalMixturePh: z.number().min(0).max(14).nullable().default(null),
  included: z.boolean().default(true),
  exclusionReason: z.string().min(1).max(500).nullable().default(null),
});
export type FinalizeCaptureAttemptRequest = z.infer<typeof FinalizeCaptureAttemptRequestSchema>;

/**
 * Запрос на анализ пары reference + diagnostic по ROI.
 * В production вместо локальных путей должны использоваться ключи object storage.
 */
export const AnalyzeRequestSchema = z.object({
  referenceUri: z.string().min(1),
  diagnosticUri: z.string().min(1),
  roi: RoiRectSchema,
  debug: z.boolean().optional().default(false),
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
