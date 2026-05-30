const crypto = require("crypto");

const DATABASE_STATE_KEY = "erp-real-report-databases";
const ENCRYPTION_PREFIX = "enc:v1:";
const DEFAULT_STATE_SECRET = "customized-report-default-state-secret-v1";

function getStateSecret() {
  return process.env.ERP_STATE_SECRET || process.env.APP_STATE_SECRET || DEFAULT_STATE_SECRET;
}

function getEncryptionKey() {
  return crypto.createHash("sha256").update(getStateSecret()).digest();
}

function isEncryptedText(value) {
  return typeof value === "string" && value.startsWith(ENCRYPTION_PREFIX);
}

function encryptText(value) {
  if (!value || isEncryptedText(value)) return value || "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENCRYPTION_PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

function decryptText(value) {
  if (!isEncryptedText(value)) return value || "";
  const payload = value.slice(ENCRYPTION_PREFIX.length);
  const [ivText, tagText, encryptedText] = payload.split(":");
  if (!ivText || !tagText || !encryptedText) {
    throw new Error("数据库密码密文格式不正确。");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(ivText, "base64"));
  decipher.setAuthTag(Buffer.from(tagText, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64")), decipher.final()]).toString("utf8");
}

function mapDatabasePasswords(value, mapper) {
  if (!Array.isArray(value)) return value;
  return value.map((database) => {
    if (!database || typeof database !== "object") return database;
    return {
      ...database,
      password: mapper(database.password || ""),
    };
  });
}

function serializeStateValue(key, value) {
  if (key !== DATABASE_STATE_KEY) return value;
  return mapDatabasePasswords(value, encryptText);
}

function deserializeStateValue(key, value) {
  if (key !== DATABASE_STATE_KEY) return value;
  return mapDatabasePasswords(value, decryptText);
}

module.exports = {
  DATABASE_STATE_KEY,
  deserializeStateValue,
  encryptText,
  isEncryptedText,
  serializeStateValue,
};
