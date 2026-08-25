import { CapturePolicySchema } from '@cats-screening/shared';

export const activeCapturePolicy = CapturePolicySchema.parse({
  policyId: 'capture-v10',
  version: '10.0-draft.1',
  seriesId: 'V10',
  status: 'draft',
  referencePh: 6.13,
  sourcePhValues: [],
  deviceRoles: [],
  specimenModes: [],
  quotas: [],
  conditions: {
    lights: [],
    angles: [],
    distances: [],
  },
  requirePolygonRoi: true,
  instruction: 'Политика V10 ожидает утверждения.',
  reactionTargetSeconds: null,
  reactionToleranceSeconds: null,
  showFinalMixturePh: false,
  requireFinalMixturePh: false,
});
