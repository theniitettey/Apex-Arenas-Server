import { v2 as cloudinary } from 'cloudinary';
import { env } from './env.config';
import { createLogger } from '../shared/utils/logger.utils';

const logger = createLogger('cloudinary-config');

// Configure Cloudinary
cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true
});

export interface CloudinaryUploadResult {
  public_id: string;
  url: string;
  secure_url: string;
  format: string;
  width: number;
  height: number;
  bytes: number;
}

export interface CloudinaryUploadOptions {
  folder: string;
  public_id?: string;
  resource_type?: 'image' | 'raw' | 'auto';
  allowed_formats?: string[];
  max_bytes?: number;
  transformation?: any[];
}

/**
 * Upload file buffer to Cloudinary
 */
export async function uploadToCloudinary(
  fileBuffer: Buffer,
  options: CloudinaryUploadOptions
): Promise<CloudinaryUploadResult> {
  return new Promise((resolve, reject) => {
    const uploadOptions: any = {
      folder: options.folder,
      resource_type: options.resource_type || 'auto',
      allowed_formats: options.allowed_formats || ['jpg', 'jpeg', 'png', 'pdf'],
    };

    if (options.public_id) {
      uploadOptions.public_id = options.public_id;
    }

    if (options.transformation) {
      uploadOptions.transformation = options.transformation;
    }

    const uploadStream = cloudinary.uploader.upload_stream(
      uploadOptions,
      (error, result) => {
        if (error) {
          logger.error('Cloudinary upload failed:', error);
          reject(new Error('CLOUDINARY_UPLOAD_FAILED'));
          return;
        }

        if (!result) {
          reject(new Error('CLOUDINARY_NO_RESULT'));
          return;
        }

        logger.info('Cloudinary upload successful', {
          public_id: result.public_id,
          bytes: result.bytes
        });

        resolve({
          public_id: result.public_id,
          url: result.url,
          secure_url: result.secure_url,
          format: result.format,
          width: result.width || 0,
          height: result.height || 0,
          bytes: result.bytes
        });
      }
    );

    uploadStream.end(fileBuffer);
  });
}

/**
 * Delete file from Cloudinary
 */
export async function deleteFromCloudinary(publicId: string): Promise<boolean> {
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    logger.info('Cloudinary delete result', { publicId, result: result.result });
    return result.result === 'ok';
  } catch (error: any) {
    logger.error('Cloudinary delete failed:', error);
    return false;
  }
}

/**
 * Generate optimized URL for document viewing
 */
export function getOptimizedUrl(publicId: string, options?: { width?: number; height?: number }): string {
  return cloudinary.url(publicId, {
    fetch_format: 'auto',
    quality: 'auto',
    width: options?.width,
    height: options?.height,
    crop: options?.width || options?.height ? 'limit' : undefined
  });
}

export { cloudinary };
