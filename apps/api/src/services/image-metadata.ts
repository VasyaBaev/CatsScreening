import {
  CaptureCameraMetadataSchema,
  type CaptureCameraMetadata,
  type CaptureCameraMetadataContainer,
  type CaptureCameraMetadataField,
  type CaptureCameraMetadataSource,
  type CaptureCameraMetadataValues,
} from '@cats-screening/shared';
import ExifReader, { type ExpandedTags } from 'exifreader';

const EXIF_TAGS = `
Make Model Software DateTime DateTimeOriginal DateTimeDigitized
OffsetTime OffsetTimeOriginal OffsetTimeDigitized ExposureTime FNumber
ISOSpeedRatings StandardOutputSensitivity RecommendedExposureIndex ISOSpeed ExposureBiasValue
ExposureProgram ExposureMode MeteringMode WhiteBalance LightSource Flash FocalLength
FocalLengthIn35mmFilm LensMake LensModel SubjectDistance Orientation PixelXDimension PixelYDimension ColorSpace
`
  .trim()
  .split(/\s+/);

type TagRecord = Record<string, unknown>;
type MetadataBlockStatus = 'none' | 'valid' | 'malformed';

function emptyValues(): CaptureCameraMetadataValues {
  return {
    make: null,
    model: null,
    software: null,
    dateTime: null,
    dateTimeOriginal: null,
    dateTimeDigitized: null,
    offsetTime: null,
    offsetTimeOriginal: null,
    offsetTimeDigitized: null,
    exposureTimeSec: null,
    fNumber: null,
    iso: null,
    exposureBiasEv: null,
    exposureProgram: null,
    exposureMode: null,
    meteringMode: null,
    whiteBalance: null,
    lightSource: null,
    colorTemperatureKelvin: null,
    flash: null,
    focalLengthMm: null,
    focalLength35mm: null,
    lensMake: null,
    lensModel: null,
    subjectDistanceM: null,
    orientation: null,
    pixelWidth: null,
    pixelHeight: null,
    exifColorSpace: null,
    iccPresent: null,
    iccDescription: null,
  };
}

function asRecord(value: unknown): TagRecord {
  return value && typeof value === 'object' ? (value as TagRecord) : {};
}

function selectedTag(group: TagRecord, aliases: readonly string[]) {
  for (const rawTag of aliases) {
    if (Object.prototype.hasOwnProperty.call(group, rawTag)) {
      return { rawTag, tag: asRecord(group[rawTag]) };
    }
  }
  return null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (!Array.isArray(value)) return null;
  if (
    value.length === 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    value[1] !== 0
  ) {
    return value[0] / value[1];
  }
  const first = value[0];
  return typeof first === 'number' && Number.isFinite(first) ? first : null;
}

function tagNumber(tag: TagRecord): number | null {
  return finiteNumber(tag.computed) ?? finiteNumber(tag.value);
}

function boundedString(value: unknown, maxLength: number): string | null {
  const text =
    typeof value === 'string'
      ? value
      : Array.isArray(value) && value.every((item) => typeof item === 'string')
        ? value.join(' ')
        : null;
  if (text === null) return null;
  const normalized = text.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function tagString(tag: TagRecord, maxLength: number): string | null {
  return boundedString(tag.description, maxLength) ?? boundedString(tag.value, maxLength);
}

function xmpNumber(tag: TagRecord): number | null {
  const value = typeof tag.value === 'string' ? Number(tag.value.trim()) : tagNumber(tag);
  return Number.isFinite(value) ? value : null;
}

function detectContainer(buffer: Buffer): CaptureCameraMetadataContainer {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF') {
    return buffer.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : 'unknown';
  }
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))) {
    return 'gif';
  }
  if (
    buffer.length >= 4 &&
    ((buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0) ||
      (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0 && buffer[3] === 0x2a))
  ) {
    return 'tiff';
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buffer.toString('ascii', 8, 12).toLowerCase();
    if (brand === 'avif' || brand === 'avis') return 'avif';
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'].includes(brand)) return 'heic';
    if (['mif1', 'msf1'].includes(brand)) return 'heif';
  }
  if (
    (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0x0a) ||
    (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'JXL ')
  ) {
    return 'jxl';
  }
  return 'unknown';
}

function validExifPayload(payload: Buffer): boolean {
  if (payload.length < 14 || payload.toString('ascii', 0, 4) !== 'Exif') return false;
  const tiffOffset = 6;
  const littleEndian = payload.toString('ascii', tiffOffset, tiffOffset + 2) === 'II';
  const bigEndian = payload.toString('ascii', tiffOffset, tiffOffset + 2) === 'MM';
  if (!littleEndian && !bigEndian) return false;
  const readUInt16 = littleEndian
    ? (offset: number) => payload.readUInt16LE(offset)
    : (offset: number) => payload.readUInt16BE(offset);
  const readUInt32 = littleEndian
    ? (offset: number) => payload.readUInt32LE(offset)
    : (offset: number) => payload.readUInt32BE(offset);
  if (readUInt16(tiffOffset + 2) !== 42) return false;
  const firstIfd = tiffOffset + readUInt32(tiffOffset + 4);
  if (firstIfd < tiffOffset + 8 || firstIfd + 2 > payload.length) return false;
  const entryCount = readUInt16(firstIfd);
  return firstIfd + 2 + entryCount * 12 + 4 <= payload.length;
}

function inspectJpegMetadataBlocks(buffer: Buffer): MetadataBlockStatus {
  let offset = 2;
  let found = false;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) break;
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > buffer.length) return found ? 'malformed' : 'none';
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2) return found ? 'malformed' : 'none';
    const payloadStart = offset + 2;
    const payloadEnd = offset + segmentLength;
    const availableEnd = Math.min(payloadEnd, buffer.length);
    const available = buffer.subarray(payloadStart, availableEnd);
    const exif = marker === 0xe1 && available.subarray(0, 6).equals(Buffer.from('Exif\0\0'));
    const xmp =
      marker === 0xe1 &&
      available.subarray(0, 29).equals(Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'ascii'));
    const icc =
      marker === 0xe2 && available.subarray(0, 12).equals(Buffer.from('ICC_PROFILE\0', 'ascii'));
    if (exif || xmp || icc) found = true;
    if (payloadEnd > buffer.length) return found ? 'malformed' : 'none';
    if (exif && !validExifPayload(available)) return 'malformed';
    offset = payloadEnd;
  }
  return found ? 'valid' : 'none';
}

function resultFor(
  detectedContainer: CaptureCameraMetadataContainer,
  status: CaptureCameraMetadata['parser']['status'],
  diagnosticCode: CaptureCameraMetadata['parser']['diagnosticCode'],
): CaptureCameraMetadata {
  return CaptureCameraMetadataSchema.parse({
    schemaVersion: 1,
    capturePath: 'web_file_input',
    parser: { name: 'exifreader', version: '4.44.0', status, diagnosticCode },
    detectedContainer,
    values: emptyValues(),
    sources: {},
    privacy: { gpsStatus: 'absent_or_stripped' },
  });
}

function recordValue<K extends CaptureCameraMetadataField>(
  values: CaptureCameraMetadataValues,
  sources: Partial<Record<CaptureCameraMetadataField, CaptureCameraMetadataSource>>,
  field: K,
  value: CaptureCameraMetadataValues[K],
  source: CaptureCameraMetadataSource,
) {
  (values as Record<CaptureCameraMetadataField, unknown>)[field] = value;
  sources[field] = source;
}

function normalizeTags(
  parsed: ExpandedTags,
  detectedContainer: CaptureCameraMetadataContainer,
  metadataBlockStatus: MetadataBlockStatus,
): CaptureCameraMetadata {
  const exif = asRecord(parsed.exif);
  const xmp = asRecord(parsed.xmp);
  const icc = asRecord(parsed.icc);
  const gps = asRecord(parsed.gps);
  const file = asRecord(parsed.file);
  const png = asRecord(parsed.pngFile ?? parsed.png);
  const riff = asRecord(parsed.riff);
  const gif = asRecord(parsed.gif);
  const values = emptyValues();
  const sources: Partial<Record<CaptureCameraMetadataField, CaptureCameraMetadataSource>> = {};

  const addString = (
    field: CaptureCameraMetadataField,
    aliases: readonly string[],
    maxLength: number,
  ) => {
    const selected = selectedTag(exif, aliases);
    const value = selected ? tagString(selected.tag, maxLength) : null;
    if (selected && value !== null) {
      recordValue(values, sources, field, value, {
        group: 'exif',
        rawTag: selected.rawTag,
        unit: null,
      });
    }
  };
  const addNumber = (
    field: CaptureCameraMetadataField,
    aliases: readonly string[],
    unit: string | null,
  ) => {
    const selected = selectedTag(exif, aliases);
    const value = selected ? tagNumber(selected.tag) : null;
    if (selected && value !== null && value >= 0) {
      recordValue(values, sources, field, value, {
        group: 'exif',
        rawTag: selected.rawTag,
        unit,
      });
    }
  };
  const addDescription = (field: CaptureCameraMetadataField, aliases: readonly string[]) => {
    const selected = selectedTag(exif, aliases);
    const value = selected ? tagString(selected.tag, 120) : null;
    if (selected && value !== null) {
      recordValue(values, sources, field, value, {
        group: 'exif',
        rawTag: selected.rawTag,
        unit: null,
      });
    }
  };

  addString('make', ['Make'], 160);
  addString('model', ['Model'], 160);
  addString('software', ['Software'], 160);
  addString('dateTime', ['DateTime'], 64);
  addString('dateTimeOriginal', ['DateTimeOriginal'], 64);
  addString('dateTimeDigitized', ['DateTimeDigitized'], 64);
  addString('offsetTime', ['OffsetTime'], 32);
  addString('offsetTimeOriginal', ['OffsetTimeOriginal'], 32);
  addString('offsetTimeDigitized', ['OffsetTimeDigitized'], 32);
  addNumber('exposureTimeSec', ['ExposureTime'], 's');
  addNumber('fNumber', ['FNumber'], null);
  addNumber(
    'iso',
    ['ISOSpeedRatings', 'StandardOutputSensitivity', 'RecommendedExposureIndex', 'ISOSpeed'],
    null,
  );

  const exposureBias = selectedTag(exif, ['ExposureBiasValue']);
  const exposureBiasValue = exposureBias ? tagNumber(exposureBias.tag) : null;
  if (exposureBias && exposureBiasValue !== null) {
    recordValue(values, sources, 'exposureBiasEv', exposureBiasValue, {
      group: 'exif',
      rawTag: exposureBias.rawTag,
      unit: 'EV',
    });
  }

  addDescription('exposureProgram', ['ExposureProgram']);
  addDescription('exposureMode', ['ExposureMode']);
  addDescription('meteringMode', ['MeteringMode']);
  addDescription('lightSource', ['LightSource']);
  addDescription('flash', ['Flash']);

  const whiteBalance = selectedTag(exif, ['WhiteBalance']);
  const whiteBalanceCode = whiteBalance ? tagNumber(whiteBalance.tag) : null;
  const normalizedWhiteBalance =
    whiteBalanceCode === 0 ? 'Auto' : whiteBalanceCode === 1 ? 'Manual' : null;
  if (whiteBalance && normalizedWhiteBalance) {
    recordValue(values, sources, 'whiteBalance', normalizedWhiteBalance, {
      group: 'exif',
      rawTag: whiteBalance.rawTag,
      unit: null,
    });
  }

  const temperature = selectedTag(xmp, ['Temperature']);
  const kelvin = temperature ? xmpNumber(temperature.tag) : null;
  if (temperature && kelvin !== null && kelvin >= 1000 && kelvin <= 50000) {
    recordValue(values, sources, 'colorTemperatureKelvin', Math.round(kelvin), {
      group: 'xmp',
      rawTag: 'Temperature',
      unit: 'K',
    });
  }

  addNumber('focalLengthMm', ['FocalLength'], 'mm');
  addNumber('focalLength35mm', ['FocalLengthIn35mmFilm'], 'mm');
  addString('lensMake', ['LensMake'], 160);
  addString('lensModel', ['LensModel'], 160);
  addNumber('subjectDistanceM', ['SubjectDistance'], 'm');

  const orientation = selectedTag(exif, ['Orientation']);
  const orientationValue = orientation ? tagNumber(orientation.tag) : null;
  if (
    orientation &&
    orientationValue !== null &&
    Number.isInteger(orientationValue) &&
    orientationValue >= 1 &&
    orientationValue <= 8
  ) {
    recordValue(values, sources, 'orientation', orientationValue, {
      group: 'exif',
      rawTag: orientation.rawTag,
      unit: null,
    });
  }

  const dimension = (
    field: 'pixelWidth' | 'pixelHeight',
    candidates: Array<{ group: TagRecord; groupName: 'exif' | 'file'; aliases: string[] }>,
  ) => {
    for (const candidate of candidates) {
      const selected = selectedTag(candidate.group, candidate.aliases);
      const value = selected ? tagNumber(selected.tag) : null;
      if (selected && value !== null && Number.isInteger(value) && value > 0 && value <= 1000000) {
        recordValue(values, sources, field, value, {
          group: candidate.groupName,
          rawTag: selected.rawTag,
          unit: 'px',
        });
        return;
      }
    }
  };
  dimension('pixelWidth', [
    { group: exif, groupName: 'exif', aliases: ['PixelXDimension', 'ImageWidth'] },
    { group: file, groupName: 'file', aliases: ['Image Width'] },
    { group: png, groupName: 'file', aliases: ['Image Width'] },
    { group: riff, groupName: 'file', aliases: ['ImageWidth'] },
    { group: gif, groupName: 'file', aliases: ['Image Width'] },
  ]);
  dimension('pixelHeight', [
    { group: exif, groupName: 'exif', aliases: ['PixelYDimension', 'ImageLength'] },
    { group: file, groupName: 'file', aliases: ['Image Height'] },
    { group: png, groupName: 'file', aliases: ['Image Height'] },
    { group: riff, groupName: 'file', aliases: ['ImageHeight'] },
    { group: gif, groupName: 'file', aliases: ['Image Height'] },
  ]);

  const colorSpace = selectedTag(exif, ['ColorSpace']);
  const colorSpaceValue = colorSpace ? tagString(colorSpace.tag, 120) : null;
  if (colorSpace && colorSpaceValue !== null) {
    recordValue(values, sources, 'exifColorSpace', colorSpaceValue, {
      group: 'exif',
      rawTag: colorSpace.rawTag,
      unit: null,
    });
  }

  const iccPresent = Object.keys(icc).length > 0;
  values.iccPresent = iccPresent;
  if (iccPresent) {
    sources.iccPresent = { group: 'icc', rawTag: 'ICC Signature', unit: null };
  }
  const iccDescription = selectedTag(icc, ['ICC Description']);
  const iccDescriptionValue = iccDescription ? tagString(iccDescription.tag, 200) : null;
  if (iccDescription && iccDescriptionValue !== null) {
    recordValue(values, sources, 'iccDescription', iccDescriptionValue, {
      group: 'icc',
      rawTag: iccDescription.rawTag,
      unit: null,
    });
  }

  const gpsPresent =
    Object.keys(gps).length > 0 ||
    Object.keys(exif).some((key) => key.startsWith('GPS')) ||
    Object.keys(xmp).some((key) => key.startsWith('GPS'));
  const metadataPresent =
    metadataBlockStatus === 'valid' ||
    Object.keys(exif).length > 0 ||
    Object.keys(xmp).length > 0 ||
    Object.keys(icc).length > 0;

  return CaptureCameraMetadataSchema.parse({
    schemaVersion: 1,
    capturePath: 'web_file_input',
    parser: {
      name: 'exifreader',
      version: '4.44.0',
      status: metadataPresent ? 'parsed' : 'no_metadata',
      diagnosticCode: metadataPresent ? null : 'NO_CAMERA_METADATA',
    },
    detectedContainer,
    values,
    sources,
    privacy: {
      gpsStatus: gpsPresent ? 'present_then_discarded' : 'absent_or_stripped',
    },
  });
}

export function extractCaptureCameraMetadata(buffer: Buffer): CaptureCameraMetadata {
  const detectedContainer = detectContainer(buffer);
  if (detectedContainer === 'unknown') {
    return resultFor(detectedContainer, 'unsupported_format', 'UNSUPPORTED_CONTAINER');
  }

  const metadataBlockStatus =
    detectedContainer === 'jpeg' ? inspectJpegMetadataBlocks(buffer) : 'none';
  if (metadataBlockStatus === 'malformed') {
    return resultFor(detectedContainer, 'parse_error', 'METADATA_PARSE_FAILED');
  }

  try {
    const parsed = ExifReader.load(buffer, {
      expanded: true,
      includeTags: {
        exif: [...EXIF_TAGS],
        xmp: ['Temperature', 'GPSLatitude', 'GPSLongitude', 'GPSAltitude'],
        gps: true,
        icc: ['ICC Signature', 'ICC Description'],
        file: ['FileType', 'Image Width', 'Image Height'],
        png: ['Image Width', 'Image Height'],
        riff: ['ImageWidth', 'ImageHeight'],
        gif: ['Image Width', 'Image Height'],
      },
    });
    return normalizeTags(parsed, detectedContainer, metadataBlockStatus);
  } catch (error) {
    if (error instanceof ExifReader.errors.MetadataMissingError) {
      return resultFor(detectedContainer, 'no_metadata', 'NO_CAMERA_METADATA');
    }
    return resultFor(detectedContainer, 'parse_error', 'METADATA_PARSE_FAILED');
  }
}
