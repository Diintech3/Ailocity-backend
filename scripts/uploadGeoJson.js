/**
 * Run once: node scripts/uploadGeoJson.js
 * Uploads pincode-boundaries.geojson to Cloudflare R2
 */
require('dotenv').config()
const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3')
const fs = require('fs')
const path = require('path')

const client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY,
    secretAccessKey: process.env.R2_SECRET_KEY,
  },
})

const BUCKET = process.env.R2_BUCKET
const KEY = 'static/pincode-boundaries.geojson'
const FILE = path.join(__dirname, '../../frontend/public/pincode-boundaries.geojson')

async function upload() {
  if (!fs.existsSync(FILE)) {
    console.error('File not found:', FILE)
    process.exit(1)
  }

  // Already uploaded check
  try {
    await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: KEY }))
    console.log('Already exists on R2:', KEY)
    console.log(`\nR2 Public URL:\nhttps://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${BUCKET}/${KEY}`)
    return
  } catch {}

  const fileBuffer = fs.readFileSync(FILE)
  const sizeMB = (fileBuffer.length / 1024 / 1024).toFixed(1)
  console.log(`Uploading ${sizeMB}MB to R2...`)

  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: KEY,
    Body: fileBuffer,
    ContentType: 'application/geo+json',
    CacheControl: 'public, max-age=86400',
  }))

  console.log('Upload complete!')
  console.log(`\nR2 URL:\nhttps://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${BUCKET}/${KEY}`)
  console.log('\nAb Portal.jsx mein yeh URL use karo:')
  console.log(`const GEO_URL = 'https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${BUCKET}/${KEY}'`)
}

upload().catch(console.error)
