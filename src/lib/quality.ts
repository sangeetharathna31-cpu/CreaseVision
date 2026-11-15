export interface PixelQuality {
  brightness: number;
  contrast: number;
  sharpness: number;
}

export interface FaceQuality extends PixelQuality {
  available: boolean;
  visibleFraction: number;
  unavailableReason?: string;
}

export const SMALL_FACE_QUALITY_LIMITS = {
  minBrightness: 30,
  maxBrightness: 225,
  minContrast: 12,
  minSharpness: 18,
  minVisibleFraction: 0.9,
} as const;

/** Measure luminance, contrast and Laplacian sharpness from unscaled face-crop pixels. */
export function measurePixelQuality(data: ArrayLike<number>, width: number, height: number): PixelQuality | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 3 || height < 3 || data.length < width * height * 4) return null;

  const luma = new Float32Array(width * height);
  let sum = 0;
  for (let i = 0; i < luma.length; i++) {
    const offset = i * 4;
    const value = data[offset]! * 0.299 + data[offset + 1]! * 0.587 + data[offset + 2]! * 0.114;
    if (!Number.isFinite(value)) return null;
    luma[i] = value;
    sum += value;
  }
  const brightness = sum / luma.length;
  let variance = 0;
  for (const value of luma) variance += (value - brightness) ** 2;
  const contrast = Math.sqrt(variance / luma.length);

  let lapSum = 0;
  let lapSquareSum = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const laplacian = luma[i - width]! + luma[i + width]! + luma[i - 1]! + luma[i + 1]! - 4 * luma[i]!;
      lapSum += laplacian;
      lapSquareSum += laplacian * laplacian;
      count++;
    }
  }
  const meanLaplacian = lapSum / count;
  const sharpness = Math.max(0, lapSquareSum / count - meanLaplacian ** 2);
  return { brightness, contrast, sharpness };
}

export function faceQualityIssues(quality: FaceQuality | undefined): string[] {
  if (!quality?.available) return [quality?.unavailableReason || "image quality could not be measured"];
  const issues: string[] = [];
  if (quality.visibleFraction < SMALL_FACE_QUALITY_LIMITS.minVisibleFraction) issues.push("face is cropped by the image edge");
  if (quality.sharpness < SMALL_FACE_QUALITY_LIMITS.minSharpness) issues.push("face appears blurred");
  if (quality.contrast < SMALL_FACE_QUALITY_LIMITS.minContrast) issues.push("face detail is too low");
  if (quality.brightness < SMALL_FACE_QUALITY_LIMITS.minBrightness) issues.push("face is too dark");
  if (quality.brightness > SMALL_FACE_QUALITY_LIMITS.maxBrightness) issues.push("face is overexposed");
  return issues;
}
