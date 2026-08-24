/**
 * Песочница по лабораторному V5-V8 датасету.
 *
 * Назначение страницы:
 * - дать команде и заказчику вручную выбирать обучающие и тестовые пары;
 * - показать, как простая модель оценивает pH по признакам пары reference/diagnostic;
 * - визуально показать ROI-область, из которой были извлечены признаки.
 *
 * Важно:
 * - это не production-ready модель;
 * - обучение идёт в браузере на заранее посчитанных признаках, а не на сырых пикселях;
 * - основной протокол парный: reference + diagnostic.
 */

import { useEffect, useMemo, useState } from 'react';

import { FieldCaption } from '../components/InfoHint';
import { RoiImagePreview } from '../components/RoiImagePreview';
import { roiForStrategy, type RoiRect } from '../lib/roi';

type Zone = 'low' | 'normal' | 'high';
type Algorithm = 'knn' | 'centroid';

type NormalRange = {
  low: number;
  high: number;
  inclusive: boolean;
};

type PlaygroundFeature = {
  key: string;
  label: string;
  roiStrategy: string;
  featureSet: string;
  vectorSpec: string[];
  vector: number[];
  referenceRoi?: RoiRect;
  diagnosticRoi?: RoiRect;
};

type FeatureOption = Omit<PlaygroundFeature, 'vector' | 'referenceRoi' | 'diagnosticRoi'>;

type PlaygroundPair = {
  id: string;
  kind: string;
  device: string;
  lightCct: string;
  pH: number;
  class: 0 | 1;
  zone: Zone;
  sourceVersion: string;
  captureDeltaSec: number | null;
  warnings: string[];
  referenceUrl: string;
  diagnosticUrl: string;
  features: Record<string, PlaygroundFeature>;
};

type PlaygroundPack = {
  version: number;
  generatedAt: string;
  normalRange: NormalRange;
  defaultFeatureKey: string;
  featureOptions: FeatureOption[];
  pairs: PlaygroundPair[];
};

type Neighbor = {
  pair: PlaygroundPair;
  distance: number;
  weight: number;
};

type Prediction = {
  algorithm: Algorithm;
  pHEstimate: number;
  zone: Zone;
  class: 0 | 1;
  errorAbs: number;
  confidence: number;
  neighbors: Neighbor[];
};

const packUrl = '/playground/v5-v8/playground.json';

const roiLabels: Record<string, string> = {
  'fixed-wide': 'широкая центральная зона',
  'fixed-center': 'центральная зона',
  'fixed-small': 'малая центральная зона',
  'auto-flat': 'автовыбор ровной зоны',
};

const featureSetLabels: Record<string, string> = {
  core: 'базовые HSV/Lab/QC',
  'hsv-lab': 'разница HSV/Lab',
  'lab-rgb': 'разница Lab/RGB',
  'delta-only': 'только разница пары',
};

function zoneLabel(zone: Zone): string {
  if (zone === 'low') return 'Ниже нормы';
  if (zone === 'high') return 'Выше нормы';
  return 'Норма';
}

function kindLabel(kind: string): string {
  if (kind === 'base') return 'Обычная';
  if (kind === 'angle6500') return 'Угол 6500K';
  return kind;
}

function algorithmLabel(algorithm: Algorithm): string {
  return algorithm === 'knn' ? 'k ближайших соседей' : 'центроиды зон';
}

function featureOptionLabel(option: FeatureOption): string {
  const roi = roiLabels[option.roiStrategy] ?? option.roiStrategy;
  const featureSet = featureSetLabels[option.featureSet] ?? option.featureSet;
  return `${roi} - ${featureSet}`;
}

function featureOptionDescription(option?: FeatureOption): string {
  if (!option)
    return 'Выберите, какую область кадра и какие цветовые признаки использовать для обучения.';
  const roi = roiLabels[option.roiStrategy] ?? option.roiStrategy;
  const featureSet = featureSetLabels[option.featureSet] ?? option.featureSet;
  return `ROI: ${roi}. Признаки: ${featureSet}. Пунктирная рамка на карточках показывает область, из которой рассчитаны признаки.`;
}

function zoneFromPh(pH: number, range: NormalRange): Zone {
  const lowOk = range.inclusive ? pH >= range.low : pH > range.low;
  const highOk = range.inclusive ? pH <= range.high : pH < range.high;
  if (lowOk && highOk) return 'normal';
  return pH < range.low ? 'low' : 'high';
}

function classFromPh(pH: number, range: NormalRange): 0 | 1 {
  return zoneFromPh(pH, range) === 'normal' ? 0 : 1;
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

function standardize(trainVectors: number[][], testVector: number[]) {
  const dims = testVector.length;
  const means = Array.from({ length: dims }, (_, i) => {
    return (
      trainVectors.reduce((sum, vector) => sum + (vector[i] ?? 0), 0) /
      Math.max(1, trainVectors.length)
    );
  });
  const stds = means.map((mean, i) => {
    const variance =
      trainVectors.reduce((sum, vector) => {
        const diff = (vector[i] ?? 0) - mean;
        return sum + diff * diff;
      }, 0) / Math.max(1, trainVectors.length);
    return Math.sqrt(variance) || 1;
  });
  const project = (vector: number[]) =>
    vector.map((value, i) => ((value ?? 0) - (means[i] ?? 0)) / (stds[i] ?? 1));

  return {
    trainVectors: trainVectors.map(project),
    testVector: project(testVector),
  };
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function predictKnn(
  trainPairs: PlaygroundPair[],
  testPair: PlaygroundPair,
  featureKey: string,
  normalRange: NormalRange,
  k: number,
): Prediction | null {
  const train = trainPairs.filter((pair) => pair.features[featureKey]);
  const testFeature = testPair.features[featureKey];
  if (!testFeature || train.length === 0) return null;

  const { trainVectors, testVector } = standardize(
    train.map((pair) => pair.features[featureKey]!.vector),
    testFeature.vector,
  );
  const neighbors = train
    .map((pair, index) => {
      const distance = euclideanDistance(trainVectors[index] ?? [], testVector);
      return {
        pair,
        distance,
        weight: 1 / Math.max(1e-9, distance),
      };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, Math.max(1, Math.min(k, train.length)));

  const weightSum = neighbors.reduce((sum, item) => sum + item.weight, 0);
  const pHEstimate =
    weightSum > 0
      ? neighbors.reduce((sum, item) => sum + item.pair.pH * item.weight, 0) / weightSum
      : (neighbors[0]?.pair.pH ?? 6.13);
  const avgDistance = mean(neighbors.map((item) => item.distance));

  return {
    algorithm: 'knn',
    pHEstimate,
    zone: zoneFromPh(pHEstimate, normalRange),
    class: classFromPh(pHEstimate, normalRange),
    errorAbs: Math.abs(pHEstimate - testPair.pH),
    confidence: Math.max(0, Math.min(1, 1 / (1 + avgDistance))),
    neighbors,
  };
}

function centroid(vectors: number[][], dims: number): number[] {
  return Array.from({ length: dims }, (_, i) => mean(vectors.map((vector) => vector[i] ?? 0)));
}

function predictCentroid(
  trainPairs: PlaygroundPair[],
  testPair: PlaygroundPair,
  featureKey: string,
  normalRange: NormalRange,
): Prediction | null {
  const train = trainPairs.filter((pair) => pair.features[featureKey]);
  const testFeature = testPair.features[featureKey];
  if (!testFeature || train.length === 0) return null;

  const { trainVectors, testVector } = standardize(
    train.map((pair) => pair.features[featureKey]!.vector),
    testFeature.vector,
  );

  const indexedTrain = train.map((pair, index) => ({ pair, vector: trainVectors[index] ?? [] }));
  const zoneScores = (['low', 'normal', 'high'] as Zone[])
    .map((zone) => {
      const rows = indexedTrain.filter((item) => item.pair.zone === zone);
      if (rows.length === 0) return null;
      const center = centroid(
        rows.map((item) => item.vector),
        testVector.length,
      );
      return {
        zone,
        rows,
        distance: euclideanDistance(center, testVector),
      };
    })
    .filter((item): item is { zone: Zone; rows: typeof indexedTrain; distance: number } =>
      Boolean(item),
    )
    .sort((a, b) => a.distance - b.distance);

  const best = zoneScores[0];
  if (!best) return null;

  const neighbors = best.rows
    .map((item) => ({
      pair: item.pair,
      distance: euclideanDistance(item.vector, testVector),
      weight: 1 / Math.max(1e-9, euclideanDistance(item.vector, testVector)),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5);
  const weightSum = neighbors.reduce((sum, item) => sum + item.weight, 0);
  const pHEstimate =
    weightSum > 0
      ? neighbors.reduce((sum, item) => sum + item.pair.pH * item.weight, 0) / weightSum
      : mean(best.rows.map((item) => item.pair.pH));

  return {
    algorithm: 'centroid',
    pHEstimate,
    zone: zoneFromPh(pHEstimate, normalRange),
    class: classFromPh(pHEstimate, normalRange),
    errorAbs: Math.abs(pHEstimate - testPair.pH),
    confidence: Math.max(0, Math.min(1, 1 / (1 + best.distance))),
    neighbors,
  };
}

export function PlaygroundPage() {
  const [pack, setPack] = useState<PlaygroundPack | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [featureKey, setFeatureKey] = useState('fixed-wide/hsv-lab');
  const [algorithm, setAlgorithm] = useState<Algorithm>('knn');
  const [k, setK] = useState(5);
  const [zoneFilter, setZoneFilter] = useState<'all' | Zone>('all');
  const [deviceFilter, setDeviceFilter] = useState('all');
  const [lightFilter, setLightFilter] = useState('all');
  const [kindFilter, setKindFilter] = useState('all');
  const [minPh, setMinPh] = useState('4.0');
  const [maxPh, setMaxPh] = useState('7.8');
  const [trainIds, setTrainIds] = useState<string[]>([]);
  const [testId, setTestId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPack() {
      try {
        const response = await fetch(packUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const loaded = (await response.json()) as PlaygroundPack;
        if (cancelled) return;

        setPack(loaded);
        setFeatureKey(loaded.defaultFeatureKey);
        const first = loaded.pairs[0] ?? null;
        setTestId(first?.id ?? null);
        setTrainIds(loaded.pairs.filter((pair) => pair.id !== first?.id).map((pair) => pair.id));
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      }
    }

    void loadPack();
    return () => {
      cancelled = true;
    };
  }, []);

  const devices = useMemo(() => uniqueSorted(pack?.pairs.map((pair) => pair.device) ?? []), [pack]);
  const lights = useMemo(
    () => uniqueSorted(pack?.pairs.map((pair) => pair.lightCct) ?? []),
    [pack],
  );
  const kinds = useMemo(() => uniqueSorted(pack?.pairs.map((pair) => pair.kind) ?? []), [pack]);
  const selectedFeatureOption = useMemo(
    () => pack?.featureOptions.find((option) => option.key === featureKey),
    [featureKey, pack],
  );

  const filteredPairs = useMemo(() => {
    if (!pack) return [];
    const min = Number.parseFloat(minPh);
    const max = Number.parseFloat(maxPh);
    return pack.pairs.filter((pair) => {
      if (zoneFilter !== 'all' && pair.zone !== zoneFilter) return false;
      if (deviceFilter !== 'all' && pair.device !== deviceFilter) return false;
      if (lightFilter !== 'all' && pair.lightCct !== lightFilter) return false;
      if (kindFilter !== 'all' && pair.kind !== kindFilter) return false;
      if (Number.isFinite(min) && pair.pH < min) return false;
      if (Number.isFinite(max) && pair.pH > max) return false;
      return Boolean(pair.features[featureKey]);
    });
  }, [deviceFilter, featureKey, kindFilter, lightFilter, maxPh, minPh, pack, zoneFilter]);

  const pairById = useMemo(() => new Map(pack?.pairs.map((pair) => [pair.id, pair]) ?? []), [pack]);
  const testPair = testId ? (pairById.get(testId) ?? null) : null;
  const trainPairs = trainIds
    .map((id) => pairById.get(id))
    .filter((pair): pair is PlaygroundPair =>
      Boolean(pair && pair.id !== testId && pair.features[featureKey]),
    );

  const prediction = useMemo(() => {
    if (!pack || !testPair) return null;
    if (algorithm === 'centroid')
      return predictCentroid(trainPairs, testPair, featureKey, pack.normalRange);
    return predictKnn(trainPairs, testPair, featureKey, pack.normalRange, k);
  }, [algorithm, featureKey, k, pack, testPair, trainPairs]);

  function toggleTrain(pair: PlaygroundPair) {
    if (pair.id === testId) return;
    setTrainIds((current) =>
      current.includes(pair.id) ? current.filter((id) => id !== pair.id) : [...current, pair.id],
    );
  }

  function selectTest(pair: PlaygroundPair) {
    setTestId(pair.id);
    setTrainIds((current) => current.filter((id) => id !== pair.id));
  }

  function trainVisible() {
    setTrainIds(filteredPairs.filter((pair) => pair.id !== testId).map((pair) => pair.id));
  }

  function trainAllExceptTest() {
    setTrainIds(
      pack?.pairs
        .filter((pair) => pair.id !== testId && pair.features[featureKey])
        .map((pair) => pair.id) ?? [],
    );
  }

  return (
    <section className="playground-shell">
      <div className="capture-header">
        <div>
          <h1>Песочница модели</h1>
          <p>
            Датасет V5-V8: вручную выберите обучающие пары, оставьте тестовую пару и посмотрите
            оценку pH.
          </p>
        </div>
        <span className="band-pill band-normal">
          {pack ? `${pack.pairs.length} пар` : 'Загрузка'}
        </span>
      </div>

      {loadError ? (
        <div className="error-box">Не удалось загрузить данные песочницы: {loadError}</div>
      ) : null}

      <section className="playground-layout">
        <aside className="panel playground-controls">
          <h2>Эксперимент</h2>

          <label>
            <FieldCaption hint="Выбор ROI-области и набора цветовых признаков. Пунктирная рамка на фото показывает именно эту область.">
              Зона и признаки
            </FieldCaption>
            <select value={featureKey} onChange={(event) => setFeatureKey(event.target.value)}>
              {pack?.featureOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {featureOptionLabel(option)}
                </option>
              ))}
            </select>
          </label>
          <p className="control-hint">{featureOptionDescription(selectedFeatureOption)}</p>

          <div className="segmented-block">
            <FieldCaption hint="Алгоритм, который обучается прямо в браузере на выбранных train-парах. Это демонстрационный baseline, не production-модель.">
              Алгоритм
            </FieldCaption>
            <div className="segmented-row two">
              <button
                className={algorithm === 'knn' ? 'active' : ''}
                type="button"
                onClick={() => setAlgorithm('knn')}
              >
                k ближайших соседей
              </button>
              <button
                className={algorithm === 'centroid' ? 'active' : ''}
                type="button"
                onClick={() => setAlgorithm('centroid')}
              >
                Центроиды зон
              </button>
            </div>
          </div>

          <label>
            <FieldCaption hint="Сколько ближайших обучающих пар учитывать в kNN. Чем больше k, тем сильнее усреднение.">
              k для kNN
            </FieldCaption>
            <input
              min={1}
              max={15}
              type="number"
              value={k}
              onChange={(event) => setK(Number(event.target.value))}
            />
          </label>

          <div className="form-grid compact">
            <label>
              <FieldCaption hint="Нижняя граница pH для показа карточек. Не меняет уже выбранные train/test пары автоматически.">
                pH от
              </FieldCaption>
              <input value={minPh} onChange={(event) => setMinPh(event.target.value)} />
            </label>
            <label>
              <FieldCaption hint="Верхняя граница pH для показа карточек. Не меняет уже выбранные train/test пары автоматически.">
                pH до
              </FieldCaption>
              <input value={maxPh} onChange={(event) => setMaxPh(event.target.value)} />
            </label>
          </div>

          <label>
            <FieldCaption hint="Фильтр по диапазону pH: ниже нормы, норма или выше нормы. Норма сейчас 5.8-6.4 включительно.">
              Диапазон
            </FieldCaption>
            <select
              value={zoneFilter}
              onChange={(event) => setZoneFilter(event.target.value as 'all' | Zone)}
            >
              <option value="all">Все</option>
              <option value="low">Ниже нормы</option>
              <option value="normal">Норма</option>
              <option value="high">Выше нормы</option>
            </select>
          </label>

          <label>
            <FieldCaption hint="Фильтр по устройству, которым была снята пара. Полезно проверять перенос между телефонами.">
              Устройство
            </FieldCaption>
            <select value={deviceFilter} onChange={(event) => setDeviceFilter(event.target.value)}>
              <option value="all">Все</option>
              {devices.map((device) => (
                <option key={device} value={device}>
                  {device}
                </option>
              ))}
            </select>
          </label>

          <label>
            <FieldCaption hint="Фильтр по цветовой температуре лабораторного света: 2700K или 6500K.">
              Свет
            </FieldCaption>
            <select value={lightFilter} onChange={(event) => setLightFilter(event.target.value)}>
              <option value="all">Все</option>
              {lights.map((light) => (
                <option key={light} value={light}>
                  {light}
                </option>
              ))}
            </select>
          </label>

          <label>
            <FieldCaption hint="Обычная лабораторная съёмка или angle-съёмка под углом при 6500K.">
              Тип съёмки
            </FieldCaption>
            <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}>
              <option value="all">Все</option>
              {kinds.map((kind) => (
                <option key={kind} value={kind}>
                  {kindLabel(kind)}
                </option>
              ))}
            </select>
          </label>

          <div className="playground-button-stack">
            <button type="button" onClick={trainVisible}>
              Обучить на видимых
            </button>
            <button type="button" onClick={trainAllExceptTest}>
              Обучить на всех, кроме теста
            </button>
            <button type="button" onClick={() => setTrainIds([])}>
              Очистить обучение
            </button>
          </div>
        </aside>

        <section className="playground-main">
          <section className="panel prediction-panel">
            <h2>Прогноз</h2>
            <div className="prediction-grid">
              <div className="metric-box">
                <span>Пар в обучении</span>
                <strong>{trainPairs.length}</strong>
              </div>
              <div className="metric-box">
                <span>Истинный pH</span>
                <strong>{testPair ? testPair.pH.toFixed(1) : '-'}</strong>
              </div>
              <div className={`metric-box ${prediction ? `zone-${prediction.zone}` : ''}`}>
                <span>Прогноз pH</span>
                <strong>{prediction ? prediction.pHEstimate.toFixed(2) : '-'}</strong>
              </div>
              <div className="metric-box">
                <span>Ошибка</span>
                <strong>{prediction ? prediction.errorAbs.toFixed(2) : '-'}</strong>
              </div>
            </div>

            {prediction ? (
              <div className="prediction-summary">
                <span className={`band-pill band-${prediction.zone}`}>
                  {zoneLabel(prediction.zone)}
                </span>
                <span className="muted">
                  уверенность {Math.round(prediction.confidence * 100)}%
                </span>
                <span className="muted">
                  {prediction.algorithm === 'knn'
                    ? `k=${Math.min(k, trainPairs.length)}`
                    : algorithmLabel(prediction.algorithm)}
                </span>
              </div>
            ) : (
              <div className="error-box">
                Выберите тестовую пару и хотя бы одну обучающую пару с текущей зоной/признаками.
              </div>
            )}

            {prediction ? (
              <div className="neighbors">
                <h3>Ближайшие примеры</h3>
                {prediction.neighbors.map((neighbor) => (
                  <div key={neighbor.pair.id} className="neighbor-row">
                    <span>{neighbor.pair.pH.toFixed(1)}</span>
                    <span>{zoneLabel(neighbor.pair.zone)}</span>
                    <span>{neighbor.pair.device}</span>
                    <span>{neighbor.pair.lightCct}</span>
                    <span className="mono">{neighbor.distance.toFixed(3)}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <section className="playground-pair-grid">
            {filteredPairs.map((pair) => {
              const isTrain = trainIds.includes(pair.id);
              const isTest = pair.id === testId;
              const feature = pair.features[featureKey];
              const referenceRoi =
                feature?.referenceRoi ?? roiForStrategy(feature?.roiStrategy ?? 'fixed-wide');
              const diagnosticRoi =
                feature?.diagnosticRoi ?? roiForStrategy(feature?.roiStrategy ?? 'fixed-wide');

              return (
                <article
                  key={pair.id}
                  className={`pair-card ${isTrain ? 'is-train' : ''} ${isTest ? 'is-test' : ''}`}
                >
                  <div className="pair-card-head">
                    <div>
                      <strong>pH {pair.pH.toFixed(1)}</strong>
                      <span className={`band-pill small band-${pair.zone}`}>
                        {zoneLabel(pair.zone)}
                      </span>
                    </div>
                    <span className="muted">{pair.sourceVersion}</span>
                  </div>

                  <div className="pair-images">
                    <figure>
                      <RoiImagePreview
                        src={pair.referenceUrl}
                        alt={`${pair.id} чистый наполнитель`}
                        roi={referenceRoi}
                      />
                      <figcaption>Чистый наполнитель</figcaption>
                    </figure>
                    <figure>
                      <RoiImagePreview
                        src={pair.diagnosticUrl}
                        alt={`${pair.id} после реакции`}
                        roi={diagnosticRoi}
                      />
                      <figcaption>После реакции</figcaption>
                    </figure>
                  </div>

                  <div className="pair-meta">
                    <span>{pair.device}</span>
                    <span>{pair.lightCct}</span>
                    <span>{kindLabel(pair.kind)}</span>
                    <span>
                      {pair.captureDeltaSec === null ? '-' : `${pair.captureDeltaSec} сек.`}
                    </span>
                  </div>

                  {pair.warnings.length > 0 ? (
                    <div className="warning-line">Предупреждения: {pair.warnings.join(', ')}</div>
                  ) : null}

                  <div className="pair-actions">
                    <button
                      className={isTrain ? 'active' : ''}
                      disabled={isTest}
                      type="button"
                      onClick={() => toggleTrain(pair)}
                    >
                      В обучение
                    </button>
                    <button
                      className={isTest ? 'primary' : ''}
                      type="button"
                      onClick={() => selectTest(pair)}
                    >
                      Тест
                    </button>
                  </div>
                </article>
              );
            })}
          </section>
        </section>
      </section>
    </section>
  );
}
