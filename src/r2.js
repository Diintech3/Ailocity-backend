const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3')
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')
const path = require('path')
const crypto = require('crypto')

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY,
    secretAccessKey: process.env.R2_SECRET_KEY,
  },
  forcePathStyle: true,
})

const BUCKET = process.env.R2_BUCKET

/**
 * Upload buffer to R2, returns the object key (not a URL).
 */
async function uploadToR2(buffer, originalName, mimetype) {
  const ext = path.extname(originalName) || '.bin'
  const key = `uploads/${crypto.randomBytes(16).toString('hex')}${ext}`

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: mimetype,
    }),
  )

  return key
}

/**
 * Generate a presigned GET URL for a given key (expires in 1 hour).
 */
async function getPresignedUrl(key, expiresIn = 3600) {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key })
  return getSignedUrl(s3, command, { expiresIn })
}

module.exports = { uploadToR2, getPresignedUrl }
