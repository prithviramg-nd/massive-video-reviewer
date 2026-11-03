import React, { useState } from 'react';
import { CredentialsInput } from './CredentialsForm';
import {
  AwsCredentials,
  areCredentialsExpired,
  describeAccessKey,
  formatDuration,
  getMillisecondsUntilExpiry,
  parseCredentialsText,
} from '../lib/credentials';
import { DEFAULT_REGION, S3Location, parseS3Link } from '../lib/s3';
import { loadRecentLinks } from '../lib/preferences';

interface Props {
  initialLink: string;
  initialRegion: string;
  initialError?: string | null;
  credentials: AwsCredentials | null;
  onOpen: (location: S3Location, region: string) => void;
  onCredentialsChange: (credentials: AwsCredentials | null) => void;
}

const REGION_PATTERN = /^[a-z]{2}(-gov)?-[a-z]+-\d$/;

const SetupScreen: React.FC<Props> = ({ initialLink, initialRegion, initialError, credentials, onOpen, onCredentialsChange }) => {
  const [linkText, setLinkText] = useState(initialLink);
  const [regionText, setRegionText] = useState(initialRegion);
  const [credentialsText, setCredentialsText] = useState('');
  const [isReplacingCredentials, setIsReplacingCredentials] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(initialError || null);
  const recentLinks = loadRecentLinks();

  const storedCredentialsUsable = credentials !== null && !areCredentialsExpired(credentials);
  const showCredentialsInput = !storedCredentialsUsable || isReplacingCredentials;
  const remainingMs = getMillisecondsUntilExpiry(credentials);

  const handleLinkChange = (text: string) => {
    setLinkText(text);
    setErrorMessage(null);
    try {
      const parsedLocation = parseS3Link(text);
      if (parsedLocation.region) setRegionText(parsedLocation.region);
    } catch {
      // Not a complete link yet; validated on submit.
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    let location: S3Location;
    try {
      location = parseS3Link(linkText);
    } catch (error) {
      setErrorMessage((error as Error).message);
      return;
    }

    const region = (regionText.trim() || DEFAULT_REGION).toLowerCase();
    if (!REGION_PATTERN.test(region)) {
      setErrorMessage(`"${region}" does not look like an AWS region (for example us-west-1).`);
      return;
    }

    let activeCredentials: AwsCredentials | null = storedCredentialsUsable ? credentials : null;
    if (showCredentialsInput && (credentialsText.trim() || !activeCredentials)) {
      try {
        activeCredentials = parseCredentialsText(credentialsText);
      } catch (error) {
        setErrorMessage((error as Error).message);
        return;
      }
      if (areCredentialsExpired(activeCredentials)) {
        setErrorMessage('These credentials have already expired. Generate fresh ones and paste them again.');
        return;
      }
      onCredentialsChange(activeCredentials);
    }
    onOpen(location, region);
  };

  return (
    <div className="h-screen overflow-y-auto bg-slate-900">
      <div className="min-h-full flex items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-2xl bg-slate-800 border border-slate-700 rounded-xl shadow-2xl p-6 sm:p-8 space-y-6 my-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Massive Video Reviewer</h1>
          <p className="text-sm text-slate-400 mt-1">
            Open an S3 folder of .mp4 videos to review. Labels and tags are saved to <code className="text-slate-300">review_db.json</code> in
            that folder. Each tab reviews one folder, so open a new tab to review another folder at the same time.
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="s3-link" className="block text-sm font-medium text-slate-200">S3 folder link</label>
          <input
            id="s3-link"
            type="text"
            list="recent-s3-links"
            value={linkText}
            onChange={(event) => handleLinkChange(event.target.value)}
            autoFocus
            spellCheck={false}
            placeholder="s3://bucket-name/path/to/videos/"
            className="w-full bg-slate-950 border border-slate-700 rounded-md px-3 py-2 text-sm font-mono text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <datalist id="recent-s3-links">
            {recentLinks.map((recentLink) => <option key={recentLink} value={recentLink} />)}
          </datalist>
          <p className="text-xs text-slate-500">Accepts s3:// links, S3 https URLs and AWS console folder URLs.</p>
        </div>

        <div className="space-y-2">
          <label htmlFor="s3-region" className="block text-sm font-medium text-slate-200">Bucket region</label>
          <input
            id="s3-region"
            type="text"
            value={regionText}
            onChange={(event) => setRegionText(event.target.value)}
            spellCheck={false}
            placeholder={DEFAULT_REGION}
            className="w-48 bg-slate-950 border border-slate-700 rounded-md px-3 py-2 text-sm font-mono text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="space-y-2">
          <div className="block text-sm font-medium text-slate-200">AWS credentials</div>
          {storedCredentialsUsable && !isReplacingCredentials ? (
            <div className="flex flex-wrap items-center gap-3 text-sm bg-slate-950 border border-slate-700 rounded-md px-3 py-2">
              <span className="text-green-400">
                Using stored key {describeAccessKey(credentials!)}
                {remainingMs !== null && ` · expires in ${formatDuration(remainingMs)}`}
              </span>
              <button type="button" onClick={() => setIsReplacingCredentials(true)} className="text-blue-400 hover:text-blue-300">
                Replace
              </button>
              <button
                type="button"
                onClick={() => { onCredentialsChange(null); setIsReplacingCredentials(false); }}
                className="text-red-400 hover:text-red-300"
              >
                Forget
              </button>
            </div>
          ) : (
            <>
              {credentials && areCredentialsExpired(credentials) && (
                <p className="text-xs text-amber-400">Your stored credentials have expired. Paste fresh ones.</p>
              )}
              <CredentialsInput value={credentialsText} onChange={(text) => { setCredentialsText(text); setErrorMessage(null); }} />
              {isReplacingCredentials && (
                <button type="button" onClick={() => { setIsReplacingCredentials(false); setCredentialsText(''); }} className="text-xs text-slate-400 hover:text-white">
                  Keep the stored credentials
                </button>
              )}
            </>
          )}
        </div>

        {errorMessage && (
          <div className="text-sm text-red-300 bg-red-950/40 border border-red-900 rounded-md px-3 py-2">{errorMessage}</div>
        )}

        <div className="flex justify-end">
          <button type="submit" className="px-6 py-2 rounded-md text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white shadow-lg">
            Open folder
          </button>
        </div>
      </form>
      </div>
    </div>
  );
};

export default SetupScreen;
