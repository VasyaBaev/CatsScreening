import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  CapturePolicySchema,
  type CaptureAttemptUpload,
  type CapturePolicy,
  type CreatePolicyCaptureAttemptRequest,
} from '@cats-screening/shared';

import { extractCaptureCameraMetadata } from './image-metadata.js';

type CaptureStore = typeof import('./local-capture-store.js');
type ImageStorage = typeof import('./local-image-storage.js');

let storageDirectory = '';
let store: CaptureStore;
let imageStorage: ImageStorage;

before(async () => {
  storageDirectory = await mkdtemp(path.join(os.tmpdir(), 'cats-image-metadata-'));
  process.env.LOCAL_CAPTURE_STORAGE_DIR = storageDirectory;
  store = await import('./local-capture-store.js');
  imageStorage = await import('./local-image-storage.js');
});

after(async () => {
  delete process.env.LOCAL_CAPTURE_STORAGE_DIR;
  await rm(storageDirectory, { recursive: true, force: true });
});

type IfdEntry = { tag: number; type: number; count: number; value: number | Buffer };

function writeIfd(target: Buffer, offset: number, entries: IfdEntry[]) {
  target.writeUInt16LE(entries.length, offset);
  entries.forEach((entry, index) => {
    const cursor = offset + 2 + index * 12;
    target.writeUInt16LE(entry.tag, cursor);
    target.writeUInt16LE(entry.type, cursor + 2);
    target.writeUInt32LE(entry.count, cursor + 4);
    if (Buffer.isBuffer(entry.value)) entry.value.copy(target, cursor + 8, 0, 4);
    else if (entry.type === 3 && entry.count === 1) target.writeUInt16LE(entry.value, cursor + 8);
    else target.writeUInt32LE(entry.value, cursor + 8);
  });
  target.writeUInt32LE(0, offset + 2 + entries.length * 12);
}

function writeAscii(target: Buffer, offset: number, value: string) {
  const bytes = Buffer.from(value + '\0', 'ascii');
  bytes.copy(target, offset);
  return bytes.length;
}

function writeRational(target: Buffer, offset: number, numerator: number, denominator: number) {
  target.writeUInt32LE(numerator, offset);
  target.writeUInt32LE(denominator, offset + 4);
}

function jpegSegment(marker: number, payload: Buffer) {
  const header = Buffer.alloc(4);
  header[0] = 0xff;
  header[1] = marker;
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

function buildExifJpeg(
  options: {
    isoTag?: 0x8827 | 0x8833;
    iso?: number;
    whiteBalance?: 0 | 1;
    gps?: boolean;
    xmpTemperature?: number;
  } = {},
) {
  const tiff = Buffer.alloc(2700);
  tiff.write('II', 0, 'ascii');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  const makeLength = writeAscii(tiff, 200, 'Cats Camera');
  const modelLength = writeAscii(tiff, 400, 'M'.repeat(260));
  const softwareLength = writeAscii(tiff, 720, 'Capture Test');
  writeIfd(tiff, 8, [
    { tag: 0x010f, type: 2, count: makeLength, value: 200 },
    { tag: 0x0110, type: 2, count: modelLength, value: 400 },
    { tag: 0x0112, type: 3, count: 1, value: 6 },
    { tag: 0x0131, type: 2, count: softwareLength, value: 720 },
    { tag: 0x8769, type: 4, count: 1, value: 1000 },
    ...(options.gps === false ? [] : [{ tag: 0x8825, type: 4, count: 1, value: 1800 }]),
  ]);

  writeRational(tiff, 1400, 1, 125);
  writeRational(tiff, 1408, 28, 10);
  tiff.writeInt32LE(-1, 1416);
  tiff.writeInt32LE(3, 1420);
  writeRational(tiff, 1424, 50, 1);
  writeRational(tiff, 1432, 2, 1);
  const dateLength = writeAscii(tiff, 1480, '2026:08:25 10:11:12');
  const offsetLength = writeAscii(tiff, 1520, '+07:00');
  const lensMakeLength = writeAscii(tiff, 1550, 'Cats Optics');
  const lensModelLength = writeAscii(tiff, 1600, 'Test Prime 50');
  tiff.fill(0xab, 2100, 2356);
  writeIfd(
    tiff,
    1000,
    [
      { tag: 0x829a, type: 5, count: 1, value: 1400 },
      { tag: 0x829d, type: 5, count: 1, value: 1408 },
      { tag: 0x8822, type: 3, count: 1, value: 3 },
      { tag: options.isoTag ?? 0x8827, type: 3, count: 1, value: options.iso ?? 320 },
      { tag: 0x9003, type: 2, count: dateLength, value: 1480 },
      { tag: 0x9011, type: 2, count: offsetLength, value: 1520 },
      { tag: 0x9204, type: 10, count: 1, value: 1416 },
      { tag: 0x9206, type: 5, count: 1, value: 1432 },
      { tag: 0x9207, type: 3, count: 1, value: 5 },
      { tag: 0x9208, type: 3, count: 1, value: 12 },
      { tag: 0x9209, type: 3, count: 1, value: 1 },
      { tag: 0x920a, type: 5, count: 1, value: 1424 },
      { tag: 0x927c, type: 7, count: 256, value: 2100 },
      { tag: 0xa001, type: 3, count: 1, value: 1 },
      { tag: 0xa002, type: 4, count: 1, value: 4032 },
      { tag: 0xa003, type: 4, count: 1, value: 3024 },
      { tag: 0xa402, type: 3, count: 1, value: 1 },
      { tag: 0xa403, type: 3, count: 1, value: options.whiteBalance ?? 0 },
      { tag: 0xa405, type: 3, count: 1, value: 50 },
      { tag: 0xa433, type: 2, count: lensMakeLength, value: 1550 },
      { tag: 0xa434, type: 2, count: lensModelLength, value: 1600 },
    ].sort((left, right) => left.tag - right.tag),
  );

  if (options.gps !== false) {
    writeRational(tiff, 2000, 13, 1);
    writeRational(tiff, 2008, 45, 1);
    writeRational(tiff, 2016, 0, 1);
    writeRational(tiff, 2024, 100, 1);
    writeRational(tiff, 2032, 30, 1);
    writeRational(tiff, 2040, 0, 1);
    writeIfd(tiff, 1800, [
      { tag: 0x0001, type: 2, count: 2, value: Buffer.from([0x4e, 0, 0, 0]) },
      { tag: 0x0002, type: 5, count: 3, value: 2000 },
      { tag: 0x0003, type: 2, count: 2, value: Buffer.from([0x45, 0, 0, 0]) },
      { tag: 0x0004, type: 5, count: 3, value: 2024 },
    ]);
  }

  const segments = [
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), tiff])),
  ];
  if (options.xmpTemperature) {
    const xml = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" crs:Temperature="${options.xmpTemperature}"/></rdf:RDF></x:xmpmeta>`;
    segments.push(
      jpegSegment(
        0xe1,
        Buffer.concat([
          Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'ascii'),
          Buffer.from(xml, 'utf8'),
        ]),
      ),
    );
  }
  segments.push(Buffer.from([0xff, 0xd9]));
  return Buffer.concat(segments);
}

function activePolicy(): CapturePolicy {
  return CapturePolicySchema.parse({
    policyId: 'metadata-test',
    version: 'test-1',
    seriesId: 'metadata-series',
    status: 'active',
    referencePh: 6.13,
    sourcePhValues: [5.8],
    deviceRoles: [{ value: 'phone', label: 'Phone' }],
    specimenModes: ['independent'],
    quotas: [{ sourcePh: 5.8, deviceRole: 'phone', specimenMode: 'independent', target: 10 }],
    conditions: {
      lights: [{ value: 'daylight', label: 'Daylight' }],
      angles: [{ value: 'straight', label: 'Straight' }],
      distances: [{ value: 'normal', label: 'Normal' }],
    },
    requirePolygonRoi: false,
    instruction: 'Metadata test.',
    reactionTargetSeconds: null,
    reactionToleranceSeconds: null,
    showFinalMixturePh: false,
    requireFinalMixturePh: false,
  });
}

const selection: CreatePolicyCaptureAttemptRequest = {
  sourcePh: 5.8,
  referencePh: 6.13,
  deviceRole: 'phone',
  specimenMode: 'independent',
  sharedSpecimenId: null,
  operatorId: 'metadata-test',
  lightLabel: 'daylight',
  angleLabel: 'straight',
  distanceLabel: 'normal',
};

test('JPEG EXIF нормализуется, ограничивается и не возвращает GPS/binary payloads', () => {
  const metadata = extractCaptureCameraMetadata(buildExifJpeg());
  assert.equal(metadata.parser.status, 'parsed');
  assert.equal(metadata.values.make, 'Cats Camera');
  assert.equal(metadata.values.model?.length, 160);
  assert.equal(metadata.values.exposureTimeSec, 1 / 125);
  assert.equal(metadata.values.fNumber, 2.8);
  assert.equal(metadata.values.iso, 320);
  assert.equal(metadata.values.whiteBalance, 'Auto');
  assert.equal(metadata.values.colorTemperatureKelvin, null);
  const explicitKelvin = extractCaptureCameraMetadata(
    buildExifJpeg({ gps: false, xmpTemperature: 6500 }),
  );
  assert.equal(explicitKelvin.values.colorTemperatureKelvin, 6500);
  assert.equal(explicitKelvin.sources.colorTemperatureKelvin?.rawTag, 'Temperature');
  assert.equal(metadata.values.pixelWidth, 4032);
  assert.equal(metadata.privacy.gpsStatus, 'present_then_discarded');
  assert.doesNotMatch(
    JSON.stringify(metadata),
    /GPSLatitude|GPSLongitude|MakerNote|Thumbnail|_raw/,
  );
});

test('ISO alias и WhiteBalance Manual остаются нормализованными', () => {
  const metadata = extractCaptureCameraMetadata(
    buildExifJpeg({ isoTag: 0x8833, iso: 640, whiteBalance: 1, gps: false }),
  );
  assert.equal(metadata.values.iso, 640);
  assert.equal(metadata.sources.iso?.rawTag, 'ISOSpeed');
  assert.equal(metadata.values.whiteBalance, 'Manual');
});

test('no EXIF, malformed metadata и неизвестный container получают разные statuses', () => {
  const noMetadata = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==', 'base64');
  const malformed = Buffer.from('ffd8ffe1001045786966000049492a00ffffffffffd9', 'hex');
  assert.equal(extractCaptureCameraMetadata(noMetadata).parser.status, 'no_metadata');
  assert.equal(extractCaptureCameraMetadata(malformed).parser.status, 'parse_error');
  assert.equal(
    extractCaptureCameraMetadata(Buffer.from([1, 2, 3])).parser.status,
    'unsupported_format',
  );
});

test('storage сохраняет исходные bytes/SHA и добавляет metadata того же Buffer', async () => {
  const buffer = buildExifJpeg({ gps: false });
  const original = Buffer.from(buffer);
  const upload = await imageStorage.saveLocalAttemptImage({
    attemptId: 'metadata-bytes',
    slotKey: 'reference',
    kind: 'reference',
    fileName: 'reference.jpg',
    contentType: 'image/jpeg',
    buffer,
  });
  const storedPath = path.join(storageDirectory, ...upload.uri.slice('local://'.length).split('/'));
  assert.deepEqual(buffer, original);
  assert.deepEqual(await readFile(storedPath), original);
  assert.equal(upload.bytes, original.byteLength);
  assert.equal(upload.sha256, createHash('sha256').update(original).digest('hex'));
  assert.equal(upload.cameraMetadata?.parser.status, 'parsed');
});

test('no_metadata и parse_error не превращают attempt upload в HTTP failure', async () => {
  const policy = activePolicy();
  const noMetadataAttempt = await store.createPolicyCaptureAttempt(policy, selection);
  const malformedAttempt = await store.createPolicyCaptureAttempt(policy, selection);
  const { buildServer } = await import('../server.js');
  const app = await buildServer({ logger: false });
  try {
    const responses = await Promise.all([
      app.inject({
        method: 'PUT',
        url: `/api/uploads/attempts/${noMetadataAttempt.id}/slots/reference`,
        headers: { 'content-type': 'image/jpeg', 'x-file-name': 'plain.jpg' },
        payload: Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==', 'base64'),
      }),
      app.inject({
        method: 'PUT',
        url: `/api/uploads/attempts/${malformedAttempt.id}/slots/reference`,
        headers: { 'content-type': 'image/jpeg', 'x-file-name': 'malformed.jpg' },
        payload: Buffer.from('ffd8ffe1001045786966000049492a00ffffffffffd9', 'hex'),
      }),
    ]);
    assert.deepEqual(
      responses.map((response) => response.statusCode),
      [201, 201],
    );
    assert.deepEqual(
      responses.map((response) => response.json().upload.cameraMetadata.parser.status),
      ['no_metadata', 'parse_error'],
    );
  } finally {
    await app.close();
  }
});

test('старый upload без optional cameraMetadata читается', async () => {
  const attempt = await store.createPolicyCaptureAttempt(activePolicy(), selection);
  const legacyUpload: CaptureAttemptUpload = {
    slotKey: 'reference',
    kind: 'reference',
    fileName: 'legacy.jpg',
    contentType: 'image/jpeg',
    bytes: 4,
    sha256: 'a'.repeat(64),
    uri: 'local://legacy.jpg',
    publicUrl: null,
    savedAt: '2026-08-25T00:00:00.000Z',
    roi: null,
  };
  await store.saveLocalAttemptUpload(attempt.id, legacyUpload);
  assert.equal(
    (await store.getLocalCaptureAttempt(attempt.id)).uploads.reference.cameraMetadata,
    undefined,
  );
});
