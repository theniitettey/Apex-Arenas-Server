import { cloudinary } from '../../configs/cloudinary.config';
import { createLogger } from './logger.utils';
import { AppError } from './error.utils';

const logger = createLogger('cloudinary-utils');

// ============================================
// TYPES
// ============================================
export interface UploadResult {
  url: string;
  public_id: string;
  format: string;
  resource_type: 'image' | 'video' | 'raw';
  bytes: number;
  width?: number;
  height?: number;
  duration?: number; // for videos
}

export interface UploadOptions {
  folder?: string;
  resource_type?: 'image' | 'video' | 'auto' | 'raw';
  allowed_formats?: string[];
  max_bytes?: number;
  transformation?: object;
}

const DEFAULT_OPTIONS: UploadOptions = {
  folder: 'apex-arenas/evidence',
  resource_type: 'auto',
  allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'mov', 'avi', 'webm'],
  max_bytes: 50 * 1024 * 1024 // 50MB max
};

// ============================================
// UPLOAD FROM BUFFER (for multer/form uploads)
// ============================================
export async function uploadToCloudinary(
  fileBuffer: Buffer,
  options: UploadOptions = {}
): Promise<UploadResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: opts.folder,
        resource_type: opts.resource_type,
        allowed_formats: opts.allowed_formats,
      },
      (error, result) => {
        if (error) {
          logger.error('Cloudinary upload failed', { error: error.message });
          reject(new AppError('UPLOAD_FAILED', `Failed to upload file: ${error.message}`));
          return;
        }

        if (!result) {
          reject(new AppError('UPLOAD_FAILED', 'No result from Cloudinary'));
          return;
        }

        logger.info('Cloudinary upload successful', { public_id: result.public_id });
        resolve({
          url: result.secure_url,
          public_id: result.public_id,
          format: result.format,
          resource_type: result.resource_type as 'image' | 'video' | 'raw',
          bytes: result.bytes,
          width: result.width,
          height: result.height,
          duration: result.duration
        });
      }
    );

    uploadStream.end(fileBuffer);
  });
}

// ============================================
// UPLOAD FROM BASE64 (for mobile/API uploads)
// ============================================
export async function uploadBase64ToCloudinary(
  base64String: string,
  options: UploadOptions = {}
): Promise<UploadResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  try {
    const result = await cloudinary.uploader.upload(base64String, {
      folder: opts.folder,
      resource_type: opts.resource_type,
      allowed_formats: opts.allowed_formats,
    });

    logger.info('Cloudinary base64 upload successful', { public_id: result.public_id });
    return {
      url: result.secure_url,
      public_id: result.public_id,
      format: result.format,
      resource_type: result.resource_type as 'image' | 'video' | 'raw',
      bytes: result.bytes,
      width: result.width,
      height: result.height,
      duration: result.duration
    };
  } catch (error: any) {
    logger.error('Cloudinary base64 upload failed', { error: error.message });
    throw new AppError('UPLOAD_FAILED', `Failed to upload file: ${error.message}`);
  }
}

// ============================================
// DELETE FILE
// ============================================
export async function deleteFromCloudinary(
  publicId: string,
  resourceType: 'image' | 'video' | 'raw' = 'image'
): Promise<boolean> {
  try {
    const result = await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
    logger.info('Cloudinary delete successful', { public_id: publicId, result: result.result });
    return result.result === 'ok';
  } catch (error: any) {
    logger.error('Cloudinary delete failed', { publicId, error: error.message });
    throw new AppError('DELETE_FAILED', `Failed to delete file: ${error.message}`);
  }
}

// ============================================
// HELPER: Get file type from mimetype
// ============================================
export function getFileTypeFromMimetype(mimetype: string): 'image' | 'video' | 'other' {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  return 'other';
}

// ============================================
// HELPER: Generate optimized URL
// ============================================
export function getOptimizedUrl(
  publicId: string, 
  options?: { width?: number; height?: number }
): string {
  return cloudinary.url(publicId, {
    fetch_format: 'auto',
    quality: 'auto',
    width: options?.width,
    height: options?.height,
    crop: options?.width || options?.height ? 'limit' : undefined
  });
}