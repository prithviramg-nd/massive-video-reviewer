import React, { useMemo, useState } from 'react';
import { AwsCredentials, describeAccessKey, formatDuration, getMillisecondsUntilExpiry, parseCredentialsText } from '../lib/credentials';

const HELP_COMMANDS = 'aws sso login --profile <profile>\naws configure export-credentials --profile <profile> --format env';

interface CredentialsInputProps {
  value: string;
  onChange: (text: string) => void;
  autoFocus?: boolean;
}

/** Textarea for pasted AWS credentials, with live feedback on what was detected. */
export const CredentialsInput: React.FC<CredentialsInputProps> = ({ value, onChange, autoFocus }) => {
  const parseResult = useMemo(() => {
    if (!value.trim()) return null;
    try {
      return { credentials: parseCredentialsText(value), error: null as string | null };
    } catch (error) {
      return { credentials: null, error: (error as Error).message };
    }
  }, [value]);

  const remainingMs = parseResult?.credentials ? getMillisecondsUntilExpiry(parseResult.credentials) : null;

  return (
    <div className="space-y-2">
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoFocus={autoFocus}
        spellCheck={false}
        rows={5}
        placeholder={'export AWS_ACCESS_KEY_ID=ASIA...\nexport AWS_SECRET_ACCESS_KEY=...\nexport AWS_SESSION_TOKEN=...'}
        className="w-full bg-slate-950 border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {parseResult?.credentials && (
        <div className="text-xs text-green-400">
          Detected key {describeAccessKey(parseResult.credentials)}
          {parseResult.credentials.sessionToken ? ' · session token ✓' : ' · no session token'}
          {remainingMs !== null && (remainingMs > 0 ? ` · expires in ${formatDuration(remainingMs)}` : ' · already expired')}
        </div>
      )}
      {parseResult?.error && <div className="text-xs text-amber-400">{parseResult.error}</div>}
      <details className="text-xs text-slate-400">
        <summary className="cursor-pointer hover:text-slate-200">How do I get these?</summary>
        <div className="mt-2 space-y-2">
          <p>Run this on your own machine and paste the output here:</p>
          <pre className="bg-slate-950 border border-slate-800 rounded p-2 text-slate-300 whitespace-pre-wrap">{HELP_COMMANDS}</pre>
          <p>
            Or open the AWS access portal, choose your account and role, click <b>Access keys</b>, and copy
            the block under "Set AWS environment variables". The keys stay in this browser only and are
            shared by all tabs of this site.
          </p>
        </div>
      </details>
    </div>
  );
};

interface CredentialsModalProps {
  reason: string;
  onSave: (credentials: AwsCredentials) => void;
  onClose: () => void;
}

/** Shown over the reviewer when credentials expire or are rejected. Unsaved work stays in memory. */
export const CredentialsModal: React.FC<CredentialsModalProps> = ({ reason, onSave, onClose }) => {
  const [credentialsText, setCredentialsText] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    try {
      onSave(parseCredentialsText(credentialsText));
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <form
        onSubmit={handleSubmit}
        onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}
        className="w-full max-w-xl bg-slate-900 border border-slate-700 rounded-lg shadow-2xl p-6 space-y-4"
      >
        <div>
          <h2 className="text-lg font-semibold text-white">Update AWS credentials</h2>
          <p className="text-sm text-amber-300 mt-1">{reason}</p>
          <p className="text-xs text-slate-400 mt-1">Your unsaved labels are kept and will be saved once new credentials work.</p>
        </div>
        <CredentialsInput value={credentialsText} onChange={(text) => { setCredentialsText(text); setErrorMessage(null); }} autoFocus />
        {errorMessage && <div className="text-sm text-red-400">{errorMessage}</div>}
        <div className="flex justify-end space-x-3">
          <button type="button" onClick={onClose} className="px-4 py-1.5 rounded-md text-sm text-slate-300 hover:text-white">
            Later
          </button>
          <button type="submit" className="px-4 py-1.5 rounded-md text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white">
            Use these credentials
          </button>
        </div>
      </form>
    </div>
  );
};
