/**
 * Shared Multer configuration for file uploads.
 * Uses memoryStorage — files are held in buffer, then uploaded to S3 in route handlers.
 */
const multer = require('multer');

const ALLOWED_IMAGE_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
];

const ALLOWED_DOCUMENT_TYPES = [
    ...ALLOWED_IMAGE_TYPES,
    'application/pdf',
];

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * Create a configured multer instance for a given upload subdirectory.
 * Files are stored in memory (req.file.buffer) for subsequent S3 upload.
 * @param {string} subdir - Upload subdirectory hint (e.g. 'finds', 'sites') — used as S3 key prefix
 * @param {object} [opts] - Options
 * @param {boolean} [opts.allowDocuments=false] - Allow PDF uploads in addition to images
 * @returns {multer.Multer}
 */
function createUpload(subdir, opts) {
    var options = opts || {};
    var allowedTypes = options.allowDocuments ? ALLOWED_DOCUMENT_TYPES : ALLOWED_IMAGE_TYPES;

    var fileFilter = function (_req, file, cb) {
        if (allowedTypes.indexOf(file.mimetype) !== -1) {
            cb(null, true);
        } else {
            var err = new Error('Invalid file type. Allowed: ' + allowedTypes.join(', '));
            err.code = 'INVALID_FILE_TYPE';
            cb(err);
        }
    };

    return multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: MAX_FILE_SIZE },
        fileFilter: fileFilter,
    });
}

// ---------------------------------------------------------------------------
// ZIP import upload
// ---------------------------------------------------------------------------

var ALLOWED_ZIP_TYPES = ['application/zip', 'application/x-zip-compressed'];
var MAX_IMPORT_SIZE = 100 * 1024 * 1024; // 100 MB

/**
 * Create a configured multer instance for ZIP file imports.
 * @returns {multer.Multer}
 */
function createImportUpload() {
    return multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: MAX_IMPORT_SIZE },
        fileFilter: function (_req, file, cb) {
            if (ALLOWED_ZIP_TYPES.indexOf(file.mimetype) !== -1) {
                cb(null, true);
            } else {
                var err = new Error('Invalid file type. Only ZIP files are allowed.');
                err.code = 'INVALID_FILE_TYPE';
                cb(err);
            }
        },
    });
}

module.exports = {
    createUpload: createUpload,
    createImportUpload: createImportUpload,
    ALLOWED_IMAGE_TYPES: ALLOWED_IMAGE_TYPES,
    ALLOWED_DOCUMENT_TYPES: ALLOWED_DOCUMENT_TYPES,
    MAX_FILE_SIZE: MAX_FILE_SIZE,
    MAX_IMPORT_SIZE: MAX_IMPORT_SIZE,
};
