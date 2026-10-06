import { useRef, useState } from "react";
import { useUpload } from "bedrock/react";
import type { PebbleConfig, BucketNames, FileMetadata } from "bedrock";
import { Button } from "../onyx/components/button";
import { Progress } from "../onyx/components/progress";
import { Icon } from "../onyx/components/icon";

export interface UploadButtonProps<P extends PebbleConfig> {
  bucket: BucketNames<P>;
  onUpload: (file: FileMetadata) => void | Promise<void>;
  onError?: (error: unknown) => void;
  onUploadingChange?: (uploading: boolean) => void;
  accept?: string;
  disabled?: boolean;
  label?: string;
}
export function UploadButton<P extends PebbleConfig>({ bucket, onUpload, onError, onUploadingChange, accept, disabled, label = "Attach file" }: UploadButtonProps<P>) {
  const input = useRef<HTMLInputElement>(null);
  const { upload, progress, isUploading, error } = useUpload<P>(bucket);
  const [callbackError, setCallbackError] = useState<string>();
  async function choose(file: File) {
    setCallbackError(undefined); onUploadingChange?.(true);
    try { await onUpload(await upload(file)); }
    catch (cause) { setCallbackError(cause instanceof Error ? cause.message : "Upload failed."); onError?.(cause); }
    finally { onUploadingChange?.(false); if (input.current) input.current.value = ""; }
  }
  return <div className="bedrock-upload">
    <input ref={input} type="file" hidden accept={accept} disabled={disabled || isUploading} onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void choose(file); }} />
    <Button type="button" variant="outline" disabled={disabled || isUploading} onClick={() => input.current?.click()}><Icon name="attach" />{isUploading ? `Uploading ${Math.round(progress * 100)}%` : label}</Button>
    {isUploading && <Progress value={progress * 100} aria-label="Upload progress" />}
    {(error || callbackError) && <p role="alert" className="bedrock-error">{error?.message || callbackError}</p>}
  </div>;
}
