import React, { useState } from 'react';

interface Props {
  bucket: string;
}

/** The CORS rule this site needs: GET/PUT from this origin, exposing ETag for conflict-safe saves. */
export function buildCorsRule(origin: string) {
  return {
    AllowedOrigins: [origin],
    AllowedMethods: ['GET', 'PUT', 'HEAD'],
    AllowedHeaders: ['*'],
    ExposeHeaders: ['ETag', 'x-amz-bucket-region', 'x-amz-request-id'],
    MaxAgeSeconds: 3000,
  };
}

/**
 * Shell script that puts this site's rule FIRST and keeps the bucket's existing rules
 * (put-bucket-cors replaces the whole config). Safe to run twice.
 */
export function buildCorsSetupScript(bucket: string, origin: string): string {
  const ruleJson = JSON.stringify(buildCorsRule(origin));
  return [
    `aws s3api get-bucket-cors --bucket ${bucket} --query CORSRules --output json > existing-cors.json 2>/dev/null || echo '[]' > existing-cors.json`,
    `jq --argjson rule '${ruleJson}' '{CORSRules: ([$rule] + map(select(.AllowedOrigins != $rule.AllowedOrigins)))}' existing-cors.json > cors.json`,
    `aws s3api put-bucket-cors --bucket ${bucket} --cors-configuration file://cors.json`,
    `aws s3api get-bucket-cors --bucket ${bucket}`,
  ].join('\n');
}

/** Explains the one-time bucket CORS setup, with a ready-to-copy script for this bucket. */
const CorsHelp: React.FC<Props> = ({ bucket }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const setupScript = buildCorsSetupScript(bucket, window.location.origin);

  const copyScript = () => {
    navigator.clipboard.writeText(setupScript).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 1500);
    }).catch((error) => console.error('Failed to copy:', error));
  };

  if (!isOpen) {
    return (
      <button onClick={() => setIsOpen(true)} className="underline text-current hover:text-white flex-shrink-0">
        How to fix
      </button>
    );
  }

  return (
    <div className="mt-2 w-full text-left text-xs text-slate-300 space-y-2">
      <p>
        Bucket <b>{bucket}</b> needs a one-time CORS rule that allows this site ({window.location.origin}).
        It covers every folder in the bucket. Someone with <code>s3:PutBucketCors</code> on the bucket runs the
        script below in a terminal (it needs the AWS CLI and <code>jq</code>). It keeps the bucket's existing rules.
      </p>
      <pre className="bg-slate-950 border border-slate-700 rounded p-2 whitespace-pre-wrap break-all font-mono text-[11px] text-slate-200">{setupScript}</pre>
      <div className="flex space-x-3">
        <button onClick={copyScript} className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-white">
          {isCopied ? 'Copied' : 'Copy script'}
        </button>
        <button onClick={() => setIsOpen(false)} className="px-3 py-1 rounded text-slate-400 hover:text-white">
          Hide
        </button>
      </div>
    </div>
  );
};

export default CorsHelp;
