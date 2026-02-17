/**
 * S3-compatible storage service (DigitalOcean Spaces).
 * Handles file uploads, deletions, and presigned URL generation.
 */
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const path = require('path');

// ---------------------------------------------------------------------------
// Client setup
// ---------------------------------------------------------------------------
var endpoint = process.env.DO_SPACES_ENDPOINT || 'https://nyc3.digitaloceanspaces.com';
var region = process.env.DO_SPACES_REGION || 'nyc3';
var bucket = process.env.DO_SPACES_BUCKET || '';

var client = null;

function getClient() {
    if (client) return client;
    client = new S3Client({
        endpoint: endpoint,
        region: region,
        credentials: {
            accessKeyId: process.env.DO_SPACES_KEY || '',
            secretAccessKey: process.env.DO_SPACES_SECRET || '',
        },
        forcePathStyle: false,
    });
    return client;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a unique S3 key for a file upload.
 * @param {string} subdir - e.g. 'sites', 'finds', 'permissions', 'feedback'
 * @param {string} originalName - Original filename (used only for extension)
 * @returns {string} S3 key like "sites/1708531234-567890.jpg"
 */
function generateKey(subdir, originalName) {
    var ext = path.extname(originalName).toLowerCase();
    return subdir + '/' + Date.now() + '-' + Math.round(Math.random() * 1e6) + ext;
}

/**
 * Upload a file buffer to S3.
 * @param {Buffer} buffer - File contents
 * @param {string} key - S3 object key
 * @param {string} contentType - MIME type
 * @returns {Promise<string>} The S3 key
 */
async function uploadToS3(buffer, key, contentType) {
    await getClient().send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        ACL: 'private',
    }));
    return key;
}

/**
 * Delete a file from S3. Silently succeeds if object doesn't exist.
 * @param {string} key - S3 object key
 */
async function deleteFromS3(key) {
    if (!key) return;
    try {
        await getClient().send(new DeleteObjectCommand({
            Bucket: bucket,
            Key: key,
        }));
    } catch (err) {
        console.error('S3 delete error:', err.message);
    }
}

/**
 * Generate a presigned GET URL for an S3 object.
 * @param {string} key - S3 object key
 * @param {number} [expiresIn=900] - URL lifetime in seconds (default 15 minutes)
 * @returns {Promise<string>} Presigned URL
 */
async function getPresignedUrl(key, expiresIn) {
    var command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
    });
    return getSignedUrl(getClient(), command, { expiresIn: expiresIn || 900 });
}

/**
 * Download an S3 object and return it as a Buffer.
 * @param {string} key - S3 object key
 * @returns {Promise<Buffer>} File contents
 */
async function getObjectBuffer(key) {
    var command = new GetObjectCommand({ Bucket: bucket, Key: key });
    var response = await getClient().send(command);
    var chunks = [];
    for await (var chunk of response.Body) { chunks.push(chunk); }
    return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------------
// Mock support for tests
// ---------------------------------------------------------------------------
var mockStore = null;

/**
 * Enable mock mode for tests. All S3 operations use in-memory storage.
 */
function enableMock() {
    mockStore = new Map();
}

/**
 * Disable mock mode.
 */
function disableMock() {
    mockStore = null;
}

/**
 * Get the mock store (for test assertions).
 */
function getMockStore() {
    return mockStore;
}

// Wrap exports to support mocking
var s3 = {
    generateKey: generateKey,

    uploadToS3: async function (buffer, key, contentType) {
        if (mockStore) {
            mockStore.set(key, { buffer: buffer, contentType: contentType });
            return key;
        }
        return uploadToS3(buffer, key, contentType);
    },

    deleteFromS3: async function (key) {
        if (mockStore) {
            mockStore.delete(key);
            return;
        }
        return deleteFromS3(key);
    },

    getPresignedUrl: async function (key, expiresIn) {
        if (mockStore) {
            return 'https://mock-s3.test/' + bucket + '/' + key + '?expires=' + (expiresIn || 900);
        }
        return getPresignedUrl(key, expiresIn);
    },

    getObjectBuffer: async function (key) {
        if (mockStore) {
            var entry = mockStore.get(key);
            return entry ? entry.buffer : null;
        }
        return getObjectBuffer(key);
    },

    enableMock: enableMock,
    disableMock: disableMock,
    getMockStore: getMockStore,
};

module.exports = s3;
