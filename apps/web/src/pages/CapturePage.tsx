/**
 * Экран production-like съёмки пары reference + diagnostic.
 *
 * Что делает:
 * - собирает пару фотографий с известным diagnostic pH для будущего обучения;
 * - сохраняет служебные условия съёмки и browser/device metadata;
 * - показывает оператору пунктирную ROI-рамку, чтобы центральная область кадра
 *   содержала только чистый наполнитель без бортиков, плитки и других деталей.
 *
 * Почему результат модели не показывается:
 * - задача этого экрана сейчас не диагностика пользователя, а сбор ground-truth датасета;
 * - pH известен заранее и нужен как метка для последующего обучения/валидации.
 */

import {
  derivePhBand,
  type CaseMetadata,
  type PhBand,
  type RoiShape,
} from '@cats-screening/shared';
import { useEffect, useMemo, useState } from 'react';

import { FieldCaption } from '../components/InfoHint';
import { RoiEditor } from '../components/RoiEditor';
import { createCase, uploadImage } from '../lib/api';
import { FIXED_WIDE_ROI, rectToRoiShape } from '../lib/roi';

const PH_POINTS = [4.0, 4.6, 5.4, 5.6, 5.8, 6.13, 6.4, 6.6, 6.8, 7.0, 7.8];

const LIGHT_LABELS = [
  { value: 'daylight', label: 'Дневной свет' },
  { value: 'warm_indoor', label: 'Тёплый комнатный' },
  { value: 'cool_indoor', label: 'Холодный комнатный' },
  { value: 'mixed_indoor', label: 'Смешанный' },
];

const ANGLE_LABELS = [
  { value: 'straight', label: 'Ровно сверху' },
  { value: 'slight_left', label: 'Небольшой наклон слева' },
  { value: 'slight_right', label: 'Небольшой наклон справа' },
  { value: 'slight_top', label: 'Небольшой наклон сверху' },
];

const DISTANCE_LABELS = [
  { value: 'normal', label: 'Обычная' },
  { value: 'slightly_near', label: 'Чуть ближе' },
  { value: 'slightly_far', label: 'Чуть дальше' },
];

const OPERATOR_STORAGE_KEY = 'cats.capture.operatorId';
const DEVICE_STORAGE_KEY = 'cats.capture.device';

type BrowserUserAgentData = {
  platform?: string;
  mobile?: boolean;
  getHighEntropyValues?: (hints: string[]) => Promise<{
    model?: string;
    platform?: string;
    platformVersion?: string;
  }>;
};

type ImageDraft = {
  fileName: string;
  previewUrl: string;
  dataBase64: string;
  contentType: 'image/jpeg';
  capturedAt: string;
  bytes: number;
  roi: RoiShape;
};

type CaptureForm = {
  series: string;
  operatorId: string;
  device: string;
  location: string;
  tray: 'white' | 'gray' | 'yellow';
  lightLabel: string;
  angleLabel: string;
  distanceLabel: string;
  referencePh: string;
  diagnosticPh: string;
  notes: string;
};

function newPairId(): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14);
  const random = Math.random().toString(36).slice(2, 8);
  return `prodlike-${stamp}-${random}`;
}

function bandLabel(band: PhBand): string {
  if (band === 'low') return 'Ниже нормы';
  if (band === 'high') return 'Выше нормы';
  return 'Норма';
}

function readStoredValue(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function writeStoredValue(key: string, value: string) {
  try {
    const trimmed = value.trim();
    if (trimmed) window.localStorage.setItem(key, trimmed);
    else window.localStorage.removeItem(key);
  } catch {
    // Если localStorage недоступен, форма всё равно должна работать без сохранения.
  }
}

function getUserAgentData(): BrowserUserAgentData | undefined {
  return (window.navigator as Navigator & { userAgentData?: BrowserUserAgentData }).userAgentData;
}

function inferDeviceFromUserAgent(): string {
  const ua = window.navigator.userAgent;
  const uaData = getUserAgentData();
  const samsung = ua.match(/\bSM-[A-Z0-9]+\b/i)?.[0];

  if (samsung) return `Samsung ${samsung.toUpperCase()}`;
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return uaData?.mobile ? 'Android phone' : 'Android device';
  if (uaData?.platform) return uaData.mobile ? `${uaData.platform} mobile` : uaData.platform;
  if (/Windows/i.test(ua)) return 'Windows desktop';
  if (/Mac OS X/i.test(ua)) return 'macOS desktop';
  return '';
}

async function inferHighEntropyDevice(): Promise<string> {
  const uaData = getUserAgentData();
  if (!uaData?.getHighEntropyValues) return '';

  const values = await uaData.getHighEntropyValues(['model', 'platform', 'platformVersion']);
  const model = values.model?.trim();
  const platform = values.platform?.trim();

  if (model && platform) return `${platform} ${model}`;
  if (model) return model;
  if (platform) return uaData.mobile ? `${platform} mobile` : platform;
  return '';
}

function buildInitialForm(): CaptureForm {
  return {
    series: 'V9',
    operatorId: readStoredValue(OPERATOR_STORAGE_KEY),
    device: readStoredValue(DEVICE_STORAGE_KEY) || inferDeviceFromUserAgent(),
    location: 'production_like',
    tray: 'white',
    lightLabel: 'daylight',
    angleLabel: 'straight',
    distanceLabel: 'normal',
    referencePh: '6.13',
    diagnosticPh: '6.13',
    notes: '',
  };
}

function deriveBaseLight(lightLabel: string): 'day' | '3000K' | '6000K' {
  if (lightLabel === 'warm_indoor') return '3000K';
  if (lightLabel === 'cool_indoor') return '6000K';
  return 'day';
}

function readImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Не удалось прочитать изображение'));
    image.src = url;
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(blob);
  });
}

async function prepareImage(file: File): Promise<ImageDraft> {
  const sourceUrl = URL.createObjectURL(file);
  const image = await readImageElement(sourceUrl);
  const maxSide = 1800;
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas недоступен');

  context.drawImage(image, 0, 0, width, height);
  URL.revokeObjectURL(sourceUrl);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) => {
        if (!value) reject(new Error('Не удалось сжать изображение'));
        else resolve(value);
      },
      'image/jpeg',
      0.86,
    );
  });

  const dataUrl = await blobToDataUrl(blob);
  const dataBase64 = dataUrl.split(',')[1] ?? '';

  return {
    fileName: file.name.replace(/\.[^.]+$/, '.jpg'),
    previewUrl: URL.createObjectURL(blob),
    dataBase64,
    contentType: 'image/jpeg',
    capturedAt: new Date().toISOString(),
    bytes: blob.size,
    roi: rectToRoiShape(FIXED_WIDE_ROI),
  };
}

function captureDeltaSeconds(
  reference?: ImageDraft | null,
  diagnostic?: ImageDraft | null,
): number | null {
  if (!reference || !diagnostic) return null;
  const diff = new Date(diagnostic.capturedAt).getTime() - new Date(reference.capturedAt).getTime();
  if (!Number.isFinite(diff)) return null;
  return Math.max(0, Math.round(diff / 1000));
}

export function CapturePage() {
  const [form, setForm] = useState<CaptureForm>(() => buildInitialForm());
  const [pairId, setPairId] = useState(newPairId);
  const [reference, setReference] = useState<ImageDraft | null>(null);
  const [diagnostic, setDiagnostic] = useState<ImageDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedCaseId, setSavedCaseId] = useState<string | null>(null);
  const [showLightingHelp, setShowLightingHelp] = useState(false);
  const [showDistanceHelp, setShowDistanceHelp] = useState(false);

  const diagnosticPh = Number(form.diagnosticPh);
  const diagnosticBand = derivePhBand(diagnosticPh);
  const ready = reference && diagnostic && !busy;

  const delta = useMemo(() => captureDeltaSeconds(reference, diagnostic), [reference, diagnostic]);

  useEffect(() => {
    writeStoredValue(OPERATOR_STORAGE_KEY, form.operatorId);
  }, [form.operatorId]);

  useEffect(() => {
    writeStoredValue(DEVICE_STORAGE_KEY, form.device);
  }, [form.device]);

  useEffect(() => {
    let cancelled = false;

    if (readStoredValue(DEVICE_STORAGE_KEY)) return;

    inferHighEntropyDevice()
      .then((detected) => {
        if (!detected || cancelled) return;

        setForm((current) => {
          const currentValue = current.device.trim();
          if (
            currentValue &&
            !['Android phone', 'Android device', 'Windows desktop', 'macOS desktop'].includes(
              currentValue,
            )
          ) {
            return current;
          }

          return { ...current, device: detected };
        });
      })
      .catch(() => {
        // Расширенные browser hints опциональны; fallback уже заполнен из userAgent.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function update<K extends keyof CaptureForm>(key: K, value: CaptureForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleFile(kind: 'reference' | 'diagnostic', file: File | null) {
    if (!file) return;
    setError(null);
    const prepared = await prepareImage(file);

    if (kind === 'reference') setReference(prepared);
    else setDiagnostic(prepared);
  }

  function updateImageRoi(kind: 'reference' | 'diagnostic', roi: RoiShape) {
    if (kind === 'reference') {
      setReference((current) => (current ? { ...current, roi } : current));
    } else {
      setDiagnostic((current) => (current ? { ...current, roi } : current));
    }
  }

  function resetPair() {
    setReference(null);
    setDiagnostic(null);
    setPairId(newPairId());
    setSavedCaseId(null);
    setError(null);
  }

  async function submit() {
    if (!reference || !diagnostic) return;

    try {
      setBusy(true);
      setError(null);
      setSavedCaseId(null);

      const [referenceUpload, diagnosticUpload] = await Promise.all([
        uploadImage({
          pairId,
          kind: 'reference',
          fileName: reference.fileName,
          contentType: reference.contentType,
          dataBase64: reference.dataBase64,
        }),
        uploadImage({
          pairId,
          kind: 'diagnostic',
          fileName: diagnostic.fileName,
          contentType: diagnostic.contentType,
          dataBase64: diagnostic.dataBase64,
        }),
      ]);

      const metadata: CaseMetadata = {
        pH: diagnosticPh,
        class: diagnosticBand === 'normal' ? 0 : 1,
        tray: form.tray,
        light: deriveBaseLight(form.lightLabel),
        location: form.location,
        device: form.device.trim() || null,
        notes: form.notes.trim() || null,
        series: form.series.trim(),
        pairId,
        captureMode: 'production_like_lab_ground_truth',
        operatorId: form.operatorId.trim() || null,
        referencePh: Number(form.referencePh),
        diagnosticPh,
        diagnosticBand,
        condition: {
          lightLabel: form.lightLabel,
          angleLabel: form.angleLabel,
          distanceLabel: form.distanceLabel,
        },
        capture: {
          referenceCapturedAt: reference.capturedAt,
          diagnosticCapturedAt: diagnostic.capturedAt,
          captureDeltaSeconds: delta,
        },
        rois: {
          reference: reference.roi,
          diagnostic: diagnostic.roi,
        },
        client: {
          userAgent: window.navigator.userAgent,
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
          },
        },
      };

      const created = await createCase({
        metadata,
        images: [
          { kind: 'reference', uri: referenceUpload.uri },
          { kind: 'diagnostic', uri: diagnosticUpload.uri },
        ],
      });

      setSavedCaseId(created.id);
      setPairId(newPairId());
      setReference(null);
      setDiagnostic(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="capture-shell">
      <div className="capture-header">
        <div>
          <h1>Съёмка пары для обучения</h1>
          <p className="muted">
            ID пары: <span className="mono">{pairId}</span>
          </p>
        </div>
        <div className={`band-pill band-${diagnosticBand}`}>
          {bandLabel(diagnosticBand)} pH {form.diagnosticPh}
        </div>
      </div>

      <div className="capture-grid">
        <section className="panel capture-form">
          <h2>Сессия</h2>
          <div className="form-grid">
            <label>
              <FieldCaption hint="Название серии съёмки. Одинаковое значение помогает потом объединять пары в один эксперимент.">
                Серия
              </FieldCaption>
              <input
                value={form.series}
                onChange={(event) => update('series', event.target.value)}
              />
            </label>
            <label>
              <FieldCaption hint="Имя или короткий код оператора. Сохраняется в браузере, чтобы не вводить повторно.">
                Оператор
              </FieldCaption>
              <input
                value={form.operatorId}
                onChange={(event) => update('operatorId', event.target.value)}
              />
            </label>
            <label>
              <FieldCaption hint="Модель устройства. Заполняется автоматически из браузера, но её можно поправить вручную.">
                Устройство
              </FieldCaption>
              <input
                value={form.device}
                onChange={(event) => update('device', event.target.value)}
                placeholder="iPhone / Samsung"
              />
            </label>
            <label>
              <FieldCaption hint="Короткое описание места или режима съёмки. Для этой серии обычно оставляем production_like.">
                Место / режим
              </FieldCaption>
              <input
                value={form.location}
                onChange={(event) => update('location', event.target.value)}
              />
            </label>
            <label>
              <FieldCaption hint="Цвет лотка или подложки, на которой лежит наполнитель. Это помогает найти систематические ошибки по фону.">
                Лоток
              </FieldCaption>
              <select
                value={form.tray}
                onChange={(event) => update('tray', event.target.value as CaptureForm['tray'])}
              >
                <option value="white">Белый</option>
                <option value="gray">Серый</option>
                <option value="yellow">Жёлтый</option>
              </select>
            </label>
            <label>
              <FieldCaption hint="pH чистого наполнителя на reference-снимке. В текущем протоколе обычно 6.13.">
                pH чистого
              </FieldCaption>
              <input
                value={form.referencePh}
                onChange={(event) => update('referencePh', event.target.value)}
                inputMode="decimal"
              />
            </label>
            <label>
              <FieldCaption hint="Точный pH диагностического образца. Это ground truth метка, по которой потом будет обучаться модель.">
                pH после реакции
              </FieldCaption>
              <select
                value={form.diagnosticPh}
                onChange={(event) => update('diagnosticPh', event.target.value)}
              >
                {PH_POINTS.map((ph) => (
                  <option key={ph} value={String(ph)}>
                    {ph}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="segmented-block">
            <div className="field-title-row">
              <FieldCaption hint="Фактический свет при съёмке. Это не pH и не цвет лотка, а тип освещения вокруг образца.">
                Свет
              </FieldCaption>
              <button
                type="button"
                className="help-button"
                onClick={() => setShowLightingHelp((value) => !value)}
                aria-expanded={showLightingHelp}
              >
                i
              </button>
            </div>
            {showLightingHelp ? (
              <div className="help-box">
                Выберите фактический свет в комнате. Техническое поле для manifest вычисляется
                автоматически: дневной свет → day, тёплый комнатный → 3000K, холодный комнатный →
                6000K.
              </div>
            ) : null}
            <div className="segmented-row">
              {LIGHT_LABELS.map((item) => (
                <button
                  key={item.value}
                  className={form.lightLabel === item.value ? 'active' : ''}
                  type="button"
                  onClick={() => update('lightLabel', item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="segmented-block">
            <FieldCaption hint="Угол съёмки относительно наполнителя. Небольшие отклонения нужны, чтобы проверить устойчивость модели.">
              Угол
            </FieldCaption>
            <div className="segmented-row">
              {ANGLE_LABELS.map((item) => (
                <button
                  key={item.value}
                  className={form.angleLabel === item.value ? 'active' : ''}
                  type="button"
                  onClick={() => update('angleLabel', item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="segmented-block">
            <div className="field-title-row">
              <FieldCaption hint="Примерная дистанция от камеры до наполнителя. Главное, чтобы область в пунктирной рамке была заполнена чистым наполнителем.">
                Дистанция
              </FieldCaption>
              <button
                type="button"
                className="help-button"
                onClick={() => setShowDistanceHelp((value) => !value)}
                aria-expanded={showDistanceHelp}
              >
                i
              </button>
            </div>
            {showDistanceHelp ? (
              <div className="help-box">
                <ul className="help-list">
                  <li>
                    <strong>Обычная:</strong> примерно 35-45 см, наполнитель занимает большую часть
                    кадра и не обрезан.
                  </li>
                  <li>
                    <strong>Чуть ближе:</strong> примерно 25-35 см, ближе обычного, но пунктирная
                    область целиком заполнена наполнителем.
                  </li>
                  <li>
                    <strong>Чуть дальше:</strong> примерно 45-60 см, видно больше фона/лотка, но
                    наполнитель остаётся читаемым.
                  </li>
                </ul>
              </div>
            ) : null}
            <div className="segmented-row">
              {DISTANCE_LABELS.map((item) => (
                <button
                  key={item.value}
                  className={form.distanceLabel === item.value ? 'active' : ''}
                  type="button"
                  onClick={() => update('distanceLabel', item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <label>
            <FieldCaption hint="Свободный комментарий: что было необычного в съёмке, почему переснимали, какие условия отличались.">
              Комментарий
            </FieldCaption>
            <textarea
              value={form.notes}
              onChange={(event) => update('notes', event.target.value)}
              rows={3}
            />
          </label>
        </section>

        <section className="panel capture-photos">
          <h2>Фотографии</h2>
          <p className="muted">
            Пунктирная рамка показывает рабочую область анализа. Проверьте, что в неё попала только
            чистая область наполнителя, без бортиков, плитки и других деталей.
          </p>
          <div className="photo-grid">
            <PhotoSlot
              title="Чистый наполнитель"
              image={reference}
              onFile={(file) => void handleFile('reference', file)}
              onRoiChange={(roi) => updateImageRoi('reference', roi)}
            />
            <PhotoSlot
              title="После реакции"
              image={diagnostic}
              onFile={(file) => void handleFile('diagnostic', file)}
              onRoiChange={(roi) => updateImageRoi('diagnostic', roi)}
            />
          </div>

          <div className="capture-actions">
            <button type="button" className="secondary" onClick={resetPair} disabled={busy}>
              Сбросить пару
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => void submit()}
              disabled={!ready}
            >
              {busy ? 'Сохраняю...' : 'Сохранить пару'}
            </button>
          </div>

          {delta !== null ? <p className="muted">Интервал между снимками: {delta} сек.</p> : null}
          {savedCaseId ? (
            <p className="success">
              Кейс сохранён: <span className="mono">{savedCaseId}</span>
            </p>
          ) : null}
          {error ? <pre className="error-box">{error}</pre> : null}
        </section>
      </div>
    </section>
  );
}

function PhotoSlot({
  title,
  image,
  onFile,
  onRoiChange,
}: {
  title: string;
  image: ImageDraft | null;
  onFile: (file: File | null) => void;
  onRoiChange: (roi: RoiShape) => void;
}) {
  return (
    <div className="photo-slot">
      <div className="photo-slot-head">
        <span>{title}</span>
        {image ? <span className="muted">{Math.round(image.bytes / 1024)} КБ</span> : null}
      </div>
      <RoiEditor
        src={image?.previewUrl}
        alt={title}
        value={image?.roi ?? null}
        onChange={onRoiChange}
        placeholder="Фото не выбрано"
      />
      <p className="roi-guidance">
        В выбранной области должна быть только чистая область наполнителя. Сдвиньте или измените
        область так, чтобы внутри не было края лотка, плитки или фона.
      </p>
      <label className="file-button">
        Снять / выбрать фото
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(event) => onFile(event.target.files?.[0] ?? null)}
        />
      </label>
      {image ? (
        <span className="muted mono">{new Date(image.capturedAt).toLocaleString('ru-RU')}</span>
      ) : null}
    </div>
  );
}
