const express = require('express');
const { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, GetBucketLocationCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const path = require('path'); 
const posixPath = require('path').posix; 
const cors = require('cors');
const readline = require('readline');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

let BUCKET_NAME = process.env.AWS_S3_BUCKET;
let PREFIX = process.env.AWS_S3_PREFIX || '';
const DB_FILENAME = 'review_db.json';

let isInitializing = true;
let initError = null;

// Function to get bucket region
async function getBucketRegion(bucketName, initialS3Client) {
  try {
    const command = new GetBucketLocationCommand({ Bucket: bucketName });
    const response = await initialS3Client.send(command);
    // GetBucketLocation returns null for us-east-1, 'EU' for EU regions, etc.
    const location = response.LocationConstraint;
    return location === null || location === '' ? 'us-east-1' : location;
  } catch (err) {
    console.warn(`[Init] Could not auto-detect bucket region: ${err.message}`);
    return null;
  }
}

// Create initial S3 client with default region for bucket location detection
function createS3Client(region) {
  const s3Config = {
    region: region
  };

  // Only set explicit credentials if environment variables are provided
  // Otherwise, AWS SDK will use default credential chain which includes:
  // - Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
  // - AWS credentials file (~/.aws/credentials)
  // - AWS SSO credentials (when AWS_PROFILE is set and user has run 'aws sso login')
  // - IAM roles (if running on EC2/ECS/Lambda)
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    s3Config.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    };
  }

  return new S3Client(s3Config);
}

// Initialize S3 client - will be set after detecting bucket region
let s3 = createS3Client(process.env.AWS_REGION || 'us-east-1');

let cachedVideoKeys = [];
let dbState = { lastPage: 0, labels: {} };

async function loadVideoKeys() {
  console.log(`[Init] Scanning S3: ${BUCKET_NAME}/${PREFIX}...`);
  let isTruncated = true;
  let continuationToken = null;
  const keys = [];

  try {
    while (isTruncated) {
      const command = new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: PREFIX,
        ContinuationToken: continuationToken
      });

      const response = await s3.send(command);
      if (response.Contents) {
        response.Contents.forEach(obj => {
          if (obj.Key.endsWith('.mp4') && !obj.Key.endsWith(DB_FILENAME)) {
            keys.push(obj.Key);
          }
        });
      }

      isTruncated = response.IsTruncated;
      continuationToken = response.NextContinuationToken;
    }
    cachedVideoKeys = keys;
    console.log(`[Init] Found ${keys.length} videos.`);
  } catch (err) {
    console.error(`[Init] Listing error:`, err);
    throw err;
  }
}

async function loadDB() {
  const dbPath = posixPath.join(PREFIX, DB_FILENAME);
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: dbPath
    });
    const response = await s3.send(command);
    const body = await response.Body.transformToString();
    if (body) {
      dbState = JSON.parse(body);
      console.log(`[Init] DB loaded. Page: ${dbState.lastPage}, Labels: ${Object.keys(dbState.labels || {}).length}`);
    }
  } catch (err) {
    if (err.name === 'NoSuchKey') {
      console.log(`[Init] No DB found at ${dbPath}, using defaults.`);
    } else {
      console.error(`[Init] DB load error:`, err);
    }
  }
}

// Initialization will happen in startServer() after prompting

// --- API Routes ---

app.get('/api/init', (req, res) => {
  console.log(`[API] HIT /api/init`);
  if (isInitializing) return res.status(503).json({ error: 'App is still initializing...' });
  if (initError) return res.status(500).json({ error: initError });
  
  res.json({
    videoKeys: cachedVideoKeys,
    labels: dbState.labels || {},
    lastPage: dbState.lastPage || 0
  });
});

app.get('/api/page', async (req, res) => {
  console.log(`[API] HIT /api/page?page=${req.query.page}`);
  if (isInitializing) return res.status(503).json({ error: 'Initializing' });
  if (initError) return res.status(500).json({ error: initError });
  
  const page = parseInt(req.query.page) || 0;
  const size = 8;
  const startIdx = page * size;
  const slice = cachedVideoKeys.slice(startIdx, startIdx + size);

  try {
    const signedVideos = await Promise.all(slice.map(async (key) => {
      const command = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key });
      const url = await getSignedUrl(s3, command, { expiresIn: 3600 });
      return { key, url };
    }));
    res.json({ videos: signedVideos });
  } catch (err) {
    console.error(`[API] Failed to sign URLs:`, err);
    res.status(500).json({ error: 'Failed to sign URLs' });
  }
});

app.post('/api/save', async (req, res) => {
  console.log(`[API] HIT POST /api/save`);
  const { lastPage, labels } = req.body;
  const dbPath = posixPath.join(PREFIX, DB_FILENAME);
  
  dbState = { lastPage, labels };
  
  try {
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: dbPath,
      Body: JSON.stringify(dbState),
      ContentType: 'application/json'
    });
    await s3.send(command);
    res.json({ status: 'ok' });
  } catch (err) {
    console.error(`[Save] S3 Upload failed:`, err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', initialized: !isInitializing });
});

// Function to prompt for user input
function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// Parse S3 path (s3://bucket-name/path/to/videos/) into bucket and prefix
function parseS3Path(s3Path) {
  // Remove s3:// prefix if present
  s3Path = s3Path.replace(/^s3:\/\//, '');
  
  // Split by first slash to get bucket and prefix
  const parts = s3Path.split('/');
  const bucket = parts[0];
  const prefix = parts.slice(1).filter(p => p).join('/');
  
  return {
    bucket: bucket,
    prefix: prefix ? prefix + '/' : ''
  };
}

// Prompt for S3 configuration if not set via environment variables
async function promptForS3Config() {
  if (!BUCKET_NAME) {
    console.log('\n=== AWS S3 Configuration ===');
    const s3Path = await prompt('Enter S3 path (e.g., s3://bucket-name/path/to/videos/): ');
    if (!s3Path) {
      console.error('Error: S3 path is required.');
      process.exit(1);
    }
    
    const parsed = parseS3Path(s3Path);
    BUCKET_NAME = parsed.bucket;
    PREFIX = parsed.prefix;
    
    if (!BUCKET_NAME) {
      console.error('Error: Could not parse bucket name from S3 path.');
      process.exit(1);
    }
  }

  console.log(`\nConfiguration:`);
  console.log(`  Bucket: ${BUCKET_NAME}`);
  console.log(`  Prefix: ${PREFIX || '(root)'}`);
  console.log('');
}

// Start server and initialization
async function startServer() {
  // Prompt for S3 config if needed
  await promptForS3Config();
  
  // Now start the initialization
  (async () => {
    try {
      // Try to detect bucket region if region endpoint error occurs
      console.log(`[Init] Using region: ${process.env.AWS_REGION || 'us-east-1'}`);
      
      try {
        await loadVideoKeys();
        await loadDB();
      } catch (regionError) {
        // If we get a region/endpoint error, try to detect the correct region
        if (regionError.message && regionError.message.includes('endpoint')) {
          console.log(`[Init] Region mismatch detected. Attempting to detect bucket region...`);
          const bucketRegion = await getBucketRegion(BUCKET_NAME, s3);
          
          if (bucketRegion) {
            console.log(`[Init] Detected bucket region: ${bucketRegion}. Recreating S3 client...`);
            s3 = createS3Client(bucketRegion);
            
            // Retry with correct region
            await loadVideoKeys();
            await loadDB();
          } else {
            throw new Error(`Bucket region could not be detected. Please set AWS_REGION environment variable to the correct region for bucket ${BUCKET_NAME}. Error: ${regionError.message}`);
          }
        } else {
          throw regionError;
        }
      }
      
      isInitializing = false;
    } catch (err) {
      initError = err.message;
      isInitializing = false;
      console.error("[Init] Critical failure:", err);
    }
  })();

  app.listen(PORT, () => {
    console.log(`Backend server running at http://localhost:${PORT}`);
    console.log(`API endpoints available at http://localhost:${PORT}/api`);
  });
}

// Start the server
startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
