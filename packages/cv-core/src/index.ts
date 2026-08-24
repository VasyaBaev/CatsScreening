/**
 * cv-core — “чистая” часть пайплайна обработки изображений.
 *
 * Здесь нельзя:
 * - ходить в сеть,
 * - обращаться к БД,
 * - зависеть от Fastify/HTTP.
 *
 * Идея:
 * - держать алгоритмические функции отдельно, чтобы их можно было тестировать и переиспользовать.
 */

/**
 * Прямоугольник ROI в относительных координатах (0..1).
 *
 * Важно:
 * - `x/y` — координаты левого верхнего угла,
 * - `w/h` — ширина и высота,
 * - координаты считаются относительно ширины/высоты изображения.
 *
 * Зачем относительные координаты:
 * - одинаковый формат для разных разрешений,
 * - удобно хранить в JSON и передавать через API,
 * - при ресайзе кадра ROI остаётся валидным.
 */
export type RoiRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

/**
 * Изображение в RGB (sRGB), без альфы.
 *
 * Почему так:
 * - это универсальная “валюта” между декодером изображений (Node/браузер) и алгоритмами,
 * - проще и быстрее, чем таскать сложные структуры,
 * - легко сериализовать при отладке.
 *
 * Формат `data`:
 * - длина = width * height * 3,
 * - порядок байтов: R, G, B, R, G, B, ...
 */
export type RgbImage = {
  width: number;
  height: number;
  data: Uint8Array;
};

/**
 * Результат QC (контроля качества) кадра.
 *
 * Эти флаги нужны, чтобы:
 * - просить пользователя переснять фото при плохом качестве,
 * - собирать инженерные метрики (coverage, причины отказов),
 * - штрафовать confidence (если кадр “плохой”, алгоритм честно признаёт неуверенность).
 */
export type QcFlags = {
  /** Снимок размыт/смазан. */
  blur: boolean;
  /** Есть сильные блики/пересвет. */
  glare: boolean;
  /** Кадр слишком тёмный (нехватка динамического диапазона). */
  dark: boolean;
};

/**
 * Численные метрики QC.
 * Они помогают не только “флагать” плохие кадры, но и отлаживать пороги на датасете.
 */
export type QcMetrics = {
  /** Средняя яркость (0..255) по ROI. */
  meanLuma: number;
  /** Доля “пересвеченных” пикселей по ROI (0..1). */
  glareRatio: number;
  /** Оценка резкости (чем больше — тем резче). */
  blurScore: number;
  /** Доля валидных пикселей, пригодных для анализа (0..1). */
  validPixelRatio: number;
};

export type QcResult = {
  flags: QcFlags;
  metrics: QcMetrics;
};

/**
 * Признаки ROI, которые мы извлекаем для reference/diagnostic.
 *
 * Важно:
 * - в MVP мы делаем признаки максимально объяснимыми и простыми,
 * - позже (когда данных станет больше) можно заменить на ML/модель без ломки API.
 */
export type RoiFeatures = {
  /** Сколько пикселей было обработано (с учётом downsample). */
  sampleCount: number;
  /** Сколько пикселей прошло фильтры “валидности” (не слишком тёмные/не пересвеченные). */
  validCount: number;
  /** validCount / sampleCount (0..1). */
  validRatio: number;

  /** Средние значения RGB (0..1). */
  meanRgb: { r: number; g: number; b: number };

  /** Средние значения HSV (H в радианах, S/V 0..1). */
  meanHsv: { hRad: number; s: number; v: number };

  /**
   * Вектор среднего Hue (sin/cos).
   * Нужен для корректной работы с циклической природой Hue.
   */
  hueVector: { sin: number; cos: number; weight: number };

  /** Средние значения Lab (D65). */
  meanLab: { l: number; a: number; b: number };
};

export type DeltaFeatures = {
  /** Hue-разница как угол (радианы, диапазон -π..π). */
  deltaHueRad: number;
  /** Синус и косинус от deltaHueRad (удобно для регрессии). */
  deltaHueSin: number;
  deltaHueCos: number;

  deltaSat: number;
  deltaVal: number;
  deltaLabA: number;
  deltaLabB: number;
};

export type FeatureVector = {
  /** Числовой вектор фиксированной длины для kNN. */
  vector: number[];
  /** Доп. данные для отладки (не обязаны быть стабильными). */
  debug: Record<string, unknown>;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

function roiToPixels(image: RgbImage, roi: RoiRect) {
  const x0 = Math.floor(clamp01(roi.x) * image.width);
  const y0 = Math.floor(clamp01(roi.y) * image.height);
  const x1 = Math.ceil(clamp01(roi.x + roi.w) * image.width);
  const y1 = Math.ceil(clamp01(roi.y + roi.h) * image.height);

  const left = Math.max(0, Math.min(image.width - 1, x0));
  const top = Math.max(0, Math.min(image.height - 1, y0));
  const right = Math.max(left + 1, Math.min(image.width, x1));
  const bottom = Math.max(top + 1, Math.min(image.height, y1));

  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function srgbToLinear(channel: number): number {
  // channel: 0..1
  if (channel <= 0.04045) return channel / 12.92;
  return Math.pow((channel + 0.055) / 1.055, 2.4);
}

function linearToXyz(rLin: number, gLin: number, bLin: number): { x: number; y: number; z: number } {
  // Матрица для sRGB D65 (стандарт).
  const x = 0.4124564 * rLin + 0.3575761 * gLin + 0.1804375 * bLin;
  const y = 0.2126729 * rLin + 0.7151522 * gLin + 0.072175 * bLin;
  const z = 0.0193339 * rLin + 0.119192 * gLin + 0.9503041 * bLin;
  return { x, y, z };
}

function fLab(t: number): number {
  // CIE Lab helper function
  const delta = 6 / 29;
  if (t > delta ** 3) return Math.cbrt(t);
  return t / (3 * delta ** 2) + 4 / 29;
}

function xyzToLab(xyz: { x: number; y: number; z: number }): { l: number; a: number; b: number } {
  // D65 white point
  const xn = 0.95047;
  const yn = 1.0;
  const zn = 1.08883;

  const fx = fLab(xyz.x / xn);
  const fy = fLab(xyz.y / yn);
  const fz = fLab(xyz.z / zn);

  const l = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const b = 200 * (fy - fz);
  return { l, a, b };
}

function rgb01ToHsv(r: number, g: number, b: number): { hRad: number; s: number; v: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta > 1e-8) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= Math.PI / 3; // 60° -> rad
    if (h < 0) h += Math.PI * 2;
  }

  const s = max <= 1e-8 ? 0 : delta / max;
  const v = max;

  return { hRad: h, s, v };
}

function estimateSampleStep(area: number, targetSamples: number): number {
  // Уменьшаем число операций: берём примерно targetSamples пикселей.
  if (area <= 0) return 1;
  const step = Math.floor(Math.sqrt(area / targetSamples));
  return Math.max(1, step);
}

/**
 * QC на ROI диагностического кадра.
 *
 * Это простая и объяснимая эвристика, достаточная для MVP:
 * - blur: оценка резкости через дисперсию Лапласиана,
 * - glare: доля пикселей, близких к белому и с низкой насыщенностью,
 * - dark: средняя яркость ниже порога.
 *
 * Пороговые значения на старте подобраны “разумно”, но должны уточняться на датасете.
 */
export function runQualityChecksForRoi(image: RgbImage, roi: RoiRect): QcResult {
  const roiPx = roiToPixels(image, roi);
  const area = roiPx.width * roiPx.height;
  const step = estimateSampleStep(area, 50_000);

  let sampleCount = 0;
  let validCount = 0;
  let sumLuma = 0;
  let glareCount = 0;

  // Для blurScore — подготовим сетку яркости с тем же шагом.
  const gridW = Math.max(1, Math.floor(roiPx.width / step));
  const gridH = Math.max(1, Math.floor(roiPx.height / step));
  const lumaGrid = new Float32Array(gridW * gridH);

  for (let gy = 0; gy < gridH; gy += 1) {
    const y = roiPx.top + gy * step;
    for (let gx = 0; gx < gridW; gx += 1) {
      const x = roiPx.left + gx * step;
      const idx = (y * image.width + x) * 3;
      const r8 = image.data[idx] ?? 0;
      const g8 = image.data[idx + 1] ?? 0;
      const b8 = image.data[idx + 2] ?? 0;

      // Яркость по Rec.709 (0..255).
      const luma = 0.2126 * r8 + 0.7152 * g8 + 0.0722 * b8;
      lumaGrid[gy * gridW + gx] = luma;

      const r = r8 / 255;
      const g = g8 / 255;
      const b = b8 / 255;
      const hsv = rgb01ToHsv(r, g, b);

      sampleCount += 1;
      sumLuma += luma;

      // Валидные пиксели: исключаем слишком тёмные и почти белые (в них мало инфы об оттенке).
      const isValid = hsv.v > 0.15 && hsv.v < 0.98;
      if (isValid) validCount += 1;

      // Блик: очень светлый пиксель с низкой насыщенностью.
      if (hsv.v > 0.98 && hsv.s < 0.2) glareCount += 1;
    }
  }

  const meanLuma = sampleCount > 0 ? sumLuma / sampleCount : 0;
  const glareRatio = sampleCount > 0 ? glareCount / sampleCount : 0;
  const validPixelRatio = sampleCount > 0 ? validCount / sampleCount : 0;

  // Blur score: дисперсия Лапласиана на сетке яркости.
  let lapSum = 0;
  let lapSqSum = 0;
  let lapN = 0;

  for (let y = 1; y < gridH - 1; y += 1) {
    for (let x = 1; x < gridW - 1; x += 1) {
      const c = lumaGrid[y * gridW + x];
      const lap =
        lumaGrid[y * gridW + (x - 1)] +
        lumaGrid[y * gridW + (x + 1)] +
        lumaGrid[(y - 1) * gridW + x] +
        lumaGrid[(y + 1) * gridW + x] -
        4 * c;
      lapSum += lap;
      lapSqSum += lap * lap;
      lapN += 1;
    }
  }

  const lapMean = lapN > 0 ? lapSum / lapN : 0;
  const blurScore = lapN > 0 ? lapSqSum / lapN - lapMean * lapMean : 0;

  // Пороговые значения MVP (уточняются по данным).
  const flags: QcFlags = {
    blur: blurScore < 30, // чем ниже — тем более “мыльно”
    glare: glareRatio > 0.02, // 2% пересвеченных пикселей в ROI
    dark: meanLuma < 45 // слишком тёмно
  };

  return {
    flags,
    metrics: { meanLuma, glareRatio, blurScore, validPixelRatio }
  };
}

/**
 * Извлечение признаков из ROI.
 *
 * Принцип:
 * - берём downsample по ROI, чтобы ускорить обработку,
 * - считаем средние значения в нескольких цветовых пространствах,
 * - Hue считаем циркулярно (sin/cos), чтобы корректно усреднять угол.
 */
export function extractRoiFeatures(image: RgbImage, roi: RoiRect): RoiFeatures {
  const roiPx = roiToPixels(image, roi);
  const area = roiPx.width * roiPx.height;
  const step = estimateSampleStep(area, 50_000);

  let sampleCount = 0;
  let validCount = 0;

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;

  let sumS = 0;
  let sumV = 0;

  let sumHueSin = 0;
  let sumHueCos = 0;
  let sumHueW = 0;

  let sumLabL = 0;
  let sumLabA = 0;
  let sumLabB = 0;

  for (let y = roiPx.top; y < roiPx.bottom; y += step) {
    for (let x = roiPx.left; x < roiPx.right; x += step) {
      const idx = (y * image.width + x) * 3;
      const r8 = image.data[idx] ?? 0;
      const g8 = image.data[idx + 1] ?? 0;
      const b8 = image.data[idx + 2] ?? 0;

      const r = r8 / 255;
      const g = g8 / 255;
      const b = b8 / 255;

      const hsv = rgb01ToHsv(r, g, b);

      sampleCount += 1;

      sumR += r;
      sumG += g;
      sumB += b;
      sumS += hsv.s;
      sumV += hsv.v;

      const isValid = hsv.v > 0.15 && hsv.v < 0.98;
      if (isValid) validCount += 1;

      // Hue имеет смысл только если есть насыщенность (иначе он “шумный”).
      // Весом берём saturation, чтобы чуть сильнее учитывать “цветные” пиксели.
      const hueWeight = hsv.s;
      if (hueWeight > 0.05) {
        sumHueSin += Math.sin(hsv.hRad) * hueWeight;
        sumHueCos += Math.cos(hsv.hRad) * hueWeight;
        sumHueW += hueWeight;
      }

      // Lab — устройство-независимое пространство; полезно для ΔE/сдвига оттенка.
      const rLin = srgbToLinear(r);
      const gLin = srgbToLinear(g);
      const bLin = srgbToLinear(b);
      const xyz = linearToXyz(rLin, gLin, bLin);
      const lab = xyzToLab(xyz);
      sumLabL += lab.l;
      sumLabA += lab.a;
      sumLabB += lab.b;
    }
  }

  const inv = sampleCount > 0 ? 1 / sampleCount : 0;
  const meanRgb = { r: sumR * inv, g: sumG * inv, b: sumB * inv };
  const meanS = sumS * inv;
  const meanV = sumV * inv;

  const meanHueSin = sumHueW > 0 ? sumHueSin / sumHueW : 0;
  const meanHueCos = sumHueW > 0 ? sumHueCos / sumHueW : 1;
  const meanHueRad = Math.atan2(meanHueSin, meanHueCos);
  const normalizedHueRad = meanHueRad < 0 ? meanHueRad + Math.PI * 2 : meanHueRad;

  const meanLab = {
    l: sumLabL * inv,
    a: sumLabA * inv,
    b: sumLabB * inv
  };

  return {
    sampleCount,
    validCount,
    validRatio: sampleCount > 0 ? validCount / sampleCount : 0,
    meanRgb,
    meanHsv: { hRad: normalizedHueRad, s: meanS, v: meanV },
    hueVector: { sin: meanHueSin, cos: meanHueCos, weight: sumHueW },
    meanLab
  };
}

/**
 * Вычисляет “дельту” признаков diagnostic относительно reference.
 * Это ключевой приём для устойчивости:
 * - мы меньше зависим от абсолютного баланса белого/освещения,
 * - сравниваем изменение оттенка, а не сам оттенок.
 */
export function computeDeltaFeatures(reference: RoiFeatures, diagnostic: RoiFeatures): DeltaFeatures {
  const refH = reference.meanHsv.hRad;
  const diagH = diagnostic.meanHsv.hRad;

  // Нормализуем разницу в диапазон -π..π.
  let d = diagH - refH;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;

  return {
    deltaHueRad: d,
    deltaHueSin: Math.sin(d),
    deltaHueCos: Math.cos(d),
    deltaSat: diagnostic.meanHsv.s - reference.meanHsv.s,
    deltaVal: diagnostic.meanHsv.v - reference.meanHsv.v,
    deltaLabA: diagnostic.meanLab.a - reference.meanLab.a,
    deltaLabB: diagnostic.meanLab.b - reference.meanLab.b
  };
}

/**
 * Собирает вектор фиксированной длины для kNN.
 *
 * В MVP мы держим вектор маленьким, чтобы:
 * - его было легко дебажить,
 * - kNN не “тонул” в размерности на маленьких данных.
 */
export function buildFeatureVector(delta: DeltaFeatures, qc: QcResult): FeatureVector {
  const vector = [
    delta.deltaHueSin,
    delta.deltaHueCos,
    delta.deltaSat,
    delta.deltaVal,
    delta.deltaLabA,
    delta.deltaLabB,
    qc.metrics.glareRatio,
    qc.metrics.meanLuma / 255
  ];

  return {
    vector,
    debug: {
      qcFlags: qc.flags,
      qcMetrics: qc.metrics,
      delta
    }
  };
}

/**
 * Старый интерфейс (заглушка), оставлен для совместимости с текущим API.
 *
 * На следующих шагах мы переведём сервер на `runQualityChecksForRoi(...)`.
 */
export function runQualityChecks(): QcFlags {
  return { blur: false, glare: false, dark: false };
}

/**
 * Диапазон нормы pH для скрининга.
 * На текущем этапе диапазон подтверждён как 5.8–6.4 (включительно).
 */
export type NormalRange = {
  low: number;
  high: number;
  inclusive: boolean;
};

export type CalibrationVector = {
  id: string;
  pH: number;
  class: 0 | 1;
  vector: number[];
};

/**
 * Модель калибровки для kNN (MVP).
 *
 * Это не “ML модель” в классическом смысле, а набор опорных векторов + параметры,
 * которые можно хранить в JSON и легко версионировать.
 */
export type KnnCalibrationModel = {
  version: 1;
  algoVersion: string;
  generatedAt: string;
  normalRange: NormalRange;
  k: number;
  /** Масштаб дистанций для confidence (чем больше, тем ниже чувствительность к расстоянию). */
  distanceScale: number;
  /** Описание порядка компонент вектора (для дебага/воспроизводимости). */
  vectorSpec: string[];
  vectors: CalibrationVector[];
};

export type KnnNeighbor = {
  id: string;
  pH: number;
  class: 0 | 1;
  distance: number;
  weight: number;
};

export type KnnPrediction = {
  pHEstimate: number;
  avgDistance: number;
  neighbors: KnnNeighbor[];
};

function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Вектора разной длины: ${a.length} vs ${b.length}`);
  }
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * kNN‑регрессия для оценки pH.
 *
 * Почему kNN подходит на старте:
 * - маленький датасет,
 * - легко объяснять (похожие примеры → похожий pH),
 * - можно быстро итеративно улучшать признаки и сразу видеть эффект.
 */
export function knnPredict(model: KnnCalibrationModel, vector: number[]): KnnPrediction {
  const k = Math.max(1, Math.min(model.k, model.vectors.length));

  const distances = model.vectors.map((item) => {
    return {
      id: item.id,
      pH: item.pH,
      class: item.class,
      distance: euclideanDistance(item.vector, vector)
    };
  });

  distances.sort((a, b) => a.distance - b.distance);
  const top = distances.slice(0, k);

  const eps = 1e-6;
  let weightSum = 0;
  let pHSum = 0;
  let distSum = 0;

  const neighbors: KnnNeighbor[] = top.map((n) => {
    const w = 1 / (n.distance + eps);
    weightSum += w;
    pHSum += n.pH * w;
    distSum += n.distance;
    return { ...n, weight: w };
  });

  const pHEstimate = weightSum > 0 ? pHSum / weightSum : top[0]?.pH ?? 6.1;
  const avgDistance = top.length > 0 ? distSum / top.length : Infinity;

  return { pHEstimate, avgDistance, neighbors };
}

export function classifyPh(pH: number, range: NormalRange): 0 | 1 {
  const inRange = range.inclusive ? pH >= range.low && pH <= range.high : pH > range.low && pH < range.high;
  return inRange ? 0 : 1;
}

/**
 * Преобразует pH в “скор риска” 0..1.
 *
 * Идея (MVP):
 * - внутри нормы score < 0.5 и растёт к границам,
 * - за пределами нормы score >= 0.5 и растёт с удалением от границы.
 *
 * Это не “вероятность болезни”, а инженерный скрининговый сигнал.
 */
export function riskScoreFromPh(pH: number, range: NormalRange): number {
  const low = range.low;
  const high = range.high;
  const mid = (low + high) / 2;
  const half = Math.max(1e-6, (high - low) / 2);

  if (pH < low) {
    const dist = low - pH;
    return clamp(0.5 + 0.5 * (dist / 1.0), 0.5, 1.0);
  }

  if (pH > high) {
    const dist = pH - high;
    return clamp(0.5 + 0.5 * (dist / 1.0), 0.5, 1.0);
  }

  const insideNormalized = Math.min(1, Math.abs(pH - mid) / half); // 0 в центре, 1 на границах
  return clamp(0.49 * insideNormalized, 0, 0.49);
}

/**
 * Оценивает confidence 0..1 по расстоянию kNN и QC‑флагам.
 *
 * Базовая логика:
 * - чем ближе к калибровочным примерам (меньше avgDistance), тем выше уверенность,
 * - плохой QC (blur/glare/dark) уменьшает уверенность мультипликативно.
 */
export function confidenceFromKnn(avgDistance: number, model: KnnCalibrationModel, qc: QcFlags): number {
  const scale = Math.max(1e-6, model.distanceScale);
  const base = clamp(1 - avgDistance / scale, 0, 1);

  let penalty = 0;
  if (qc.blur) penalty += 0.25;
  if (qc.glare) penalty += 0.25;
  if (qc.dark) penalty += 0.25;

  return clamp(base * (1 - penalty), 0, 1);
}
