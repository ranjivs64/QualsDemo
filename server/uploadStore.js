const fs = require("node:fs");
const path = require("node:path");

const retentionMs = 24 * 60 * 60 * 1000;

function getUploadsDir() {
  return process.env.QUAL_UPLOADS_DIR || path.join(__dirname, "uploads");
}

function ensureUploadsDir() {
  fs.mkdirSync(getUploadsDir(), { recursive: true });
}

function sanitizeFileName(fileName) {
  return path.basename(fileName).replace(/[^A-Za-z0-9._-]/g, "_");
}

function saveUploadedArtifact(fileName, buffer, mimeType) {
  ensureUploadsDir();
  const safeName = sanitizeFileName(fileName);
  const storedFileName = `${Date.now()}-${safeName}`;
  const filePath = path.join(getUploadsDir(), storedFileName);
  fs.writeFileSync(filePath, buffer);
  return {
    originalFileName: fileName,
    storedFileName,
    mimeType,
    sizeBytes: buffer.length,
    uploadedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + retentionMs).toISOString()
  };
}

function cleanupExpiredArtifacts() {
  ensureUploadsDir();
  const now = Date.now();
  const uploadsDir = getUploadsDir();
  for (const entry of fs.readdirSync(uploadsDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    const filePath = path.join(uploadsDir, entry.name);
    const stats = fs.statSync(filePath);
    if (now - stats.mtimeMs > retentionMs) {
      fs.unlinkSync(filePath);
    }
  }
}

function resolveArtifactPath(storedFileName) {
  ensureUploadsDir();
  const uploadsDir = getUploadsDir();
  const safeName = sanitizeFileName(storedFileName);
  const filePath = path.join(uploadsDir, safeName);
  if (!filePath.startsWith(uploadsDir)) {
    return null;
  }
  return fs.existsSync(filePath) ? filePath : null;
}

module.exports = {
  saveUploadedArtifact,
  cleanupExpiredArtifacts,
  resolveArtifactPath
};