import multer from 'multer';
import { Request, RequestHandler } from 'express';
import { AppError } from '../../../shared/utils/error.utils';
// Store files in memory (buffer) for Cloudinary upload
const storage = multer.memoryStorage();

// File filter for evidence
const evidenceFileFilter = (
  req: Request, 
  file: Express.Multer.File, 
  cb: multer.FileFilterCallback
) => {
  const allowedMimes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'video/mp4',
    'video/quicktime', // .mov
    'video/x-msvideo', // .avi
    'video/webm'
  ];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError('INVALID_FILE_TYPE', 'Only images and videos are allowed') as any);
  }
};

// Evidence upload middleware
export const uploadEvidence = multer({
  storage,
  fileFilter: evidenceFileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max
    files: 5 // Max 5 files at once
  }
});

// Single file upload
export const uploadSingleEvidence: RequestHandler = uploadEvidence.single('evidence');

// Multiple files upload
export const uploadMultipleEvidence: RequestHandler = uploadEvidence.array('evidence', 5);