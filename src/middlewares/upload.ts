import multer from 'multer';
import { isAllowedMime, MAX_FILE_BYTES } from '../config/upload.js';
import { AppError } from '../utils/errors.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 5, fieldSize: 1024 },
  fileFilter: (_req, file, callback) => {
    if (!isAllowedMime(file.mimetype)) {
      callback(new AppError(415, 'UNSUPPORTED_FILE_TYPE', 'Only JPEG, PNG and PDF files are allowed'));
      return;
    }
    callback(null, true);
  },
});

export const uploadSingleFile = upload.single('file');