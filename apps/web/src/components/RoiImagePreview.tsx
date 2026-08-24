import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';

import { type RoiRect } from '../lib/roi';

type RoiImagePreviewProps = {
  src?: string | null;
  alt: string;
  roi?: RoiRect | null;
  className?: string;
  placeholder?: string;
};

/**
 * Preview изображения с ROI-рамкой, корректно замапленной на object-fit: contain.
 *
 * Почему нужна математика, а не простой `left: roi.x * 100%`:
 * - preview-контейнер имеет фиксированное соотношение 4:3;
 * - реальные фото могут иметь другое соотношение сторон;
 * - `object-fit: contain` добавляет поля сверху/сбоку, и ROI нужно рисовать внутри
 *   фактически отображенной картинки, а не всего контейнера.
 */
export function RoiImagePreview({
  src,
  alt,
  roi,
  className,
  placeholder = 'Фото не выбрано',
}: RoiImagePreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [roiStyle, setRoiStyle] = useState<CSSProperties | null>(null);

  const updateRoiStyle = useCallback(() => {
    const container = containerRef.current;
    const image = imageRef.current;

    if (!container || !image || !roi || !image.naturalWidth || !image.naturalHeight) {
      setRoiStyle(null);
      return;
    }

    const box = container.getBoundingClientRect();
    const containerRatio = box.width / box.height;
    const imageRatio = image.naturalWidth / image.naturalHeight;

    let displayWidth = box.width;
    let displayHeight = box.height;
    let offsetX = 0;
    let offsetY = 0;

    if (imageRatio > containerRatio) {
      displayHeight = box.width / imageRatio;
      offsetY = (box.height - displayHeight) / 2;
    } else {
      displayWidth = box.height * imageRatio;
      offsetX = (box.width - displayWidth) / 2;
    }

    setRoiStyle({
      left: `${offsetX + roi.x * displayWidth}px`,
      top: `${offsetY + roi.y * displayHeight}px`,
      width: `${roi.w * displayWidth}px`,
      height: `${roi.h * displayHeight}px`,
    });
  }, [roi]);

  useEffect(() => {
    updateRoiStyle();

    const container = containerRef.current;
    if (!container) return undefined;

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            updateRoiStyle();
          })
        : null;

    resizeObserver?.observe(container);
    window.addEventListener('resize', updateRoiStyle);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateRoiStyle);
    };
  }, [src, updateRoiStyle]);

  return (
    <div ref={containerRef} className={`roi-image-preview ${className ?? ''}`}>
      {src ? (
        <>
          <img ref={imageRef} src={src} alt={alt} onLoad={updateRoiStyle} />
          {roiStyle ? <span className="roi-overlay" style={roiStyle} aria-hidden="true" /> : null}
        </>
      ) : (
        <span className="roi-placeholder">{placeholder}</span>
      )}
    </div>
  );
}
