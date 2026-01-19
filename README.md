# Massive Video Reviewer

Large-scale S3 video review application with separate frontend and backend services.

## Project Structure

- `frontend/` - React/TypeScript frontend application (Vite)
- `backend/` - Express.js backend API server

## Prerequisites

- Node.js 18+ installed
- AWS Account with S3 bucket containing MP4 files
- IAM User/Role with `s3:ListBucket`, `s3:GetObject`, and `s3:PutObject` permissions

## Environment Variables

For AWS SSO (recommended):
```bash
# First, login to AWS SSO
aws sso login --profile your-profile-name

# Then set environment variables
export AWS_PROFILE=your-profile-name
export AWS_S3_BUCKET=netradyne-sharing
export AWS_S3_PREFIX=analytics/prithvi/detections_annotated_videos/TP/
export AWS_REGION=us-east-1  # Optional if set in AWS config
export PORT=3000  # Optional, defaults to 3000
```

The backend will automatically use your SSO credentials. No need to copy temporary credentials!

**Alternative:** If not using SSO, you can use static credentials (see `backend/README.md` for details).

## Installation

### Install Backend Dependencies

```bash
cd backend
npm install
```

### Install Frontend Dependencies

```bash
cd ../frontend
npm install
```

## Running the Application

### Development Mode

You need to run both services separately:

**Terminal 1 - Backend Server:**
```bash
cd backend
npm start
```

The backend will run on `http://localhost:3000`

**Terminal 2 - Frontend Development Server:**
```bash
cd frontend
npm run dev
```

The frontend will run on `http://localhost:5173` and proxy API requests to the backend.

### Production Build

**Build Frontend:**
```bash
cd frontend
npm run build
```

This creates a `dist/` directory with the production build. You can serve it with any static file server or integrate it with your backend.

## Usage

- Use **1, 2, 3, 4** keys to focus videos
- Use **T** (True Positive) and **F** (False Positive) to label
- Use **Left/Right Arrows** for frame-stepping (100ms/10fps)
- Use **Space** to toggle playback
- Use **PageUp/PageDown** or **[/]** to move between pages of 4 videos
- State is saved on exit (via Beacon API) or manually via the "Save" button

## API Endpoints

The backend provides the following API endpoints:

- `GET /api/init` - Initialize and get video keys and labels
- `GET /api/page?page=<number>` - Get paginated video URLs with signed S3 URLs
- `POST /api/save` - Save review state (lastPage and labels)
- `GET /api/health` - Health check endpoint

## Performance Notes

- Initial metadata sync for 100k videos takes ~10-30 seconds depending on S3 latency
- Database is stored as a single JSON file (`review_db.json`) in the S3 prefix
- Video URLs are pre-signed with a 1-hour expiry
