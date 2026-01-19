# Backend API Server

This is the backend API server for the Massive Video Reviewer application.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure AWS credentials:

   **For AWS SSO (Recommended):**
   ```bash
   # First, login to AWS SSO with your profile
   aws sso login --profile your-profile-name
   
   # Then set environment variables
   export AWS_PROFILE=your-profile-name  # Use your SSO profile name
   export AWS_S3_BUCKET=netradyne-sharing
   export AWS_S3_PREFIX=analytics/prithvi/detections_annotated_videos/TP/
   export AWS_REGION=us-west-1  # Required: bucket is in us-west-1
   export PORT=3000  # Optional, defaults to 3000
   ```
   
   **Note:** The backend will attempt to auto-detect the bucket region if the wrong region is specified, but it's recommended to set `AWS_REGION` correctly.
   
   The backend will automatically use your SSO credentials from the cached session. No need to copy temporary credentials!

   **Alternative: Use static credentials (if not using SSO):**
   ```bash
   export AWS_ACCESS_KEY_ID=your_access_key
   export AWS_SECRET_ACCESS_KEY=your_secret_key
   export AWS_REGION=us-east-1
   export AWS_S3_BUCKET=netradyne-sharing
   export AWS_S3_PREFIX=analytics/prithvi/detections_annotated_videos/TP/
   ```

3. Start the server:
```bash
npm start
```

The server will run on `http://localhost:3000` and provide the following API endpoints:
- `GET /api/init` - Initialize and get video keys and labels
- `GET /api/page?page=<number>` - Get paginated video URLs
- `POST /api/save` - Save review state
- `GET /api/health` - Health check endpoint
