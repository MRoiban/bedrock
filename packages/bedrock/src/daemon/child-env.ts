// Inherit host runtime essentials without exposing daemon credentials to pebbles.
const allowed = new Set([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LANGUAGE", "TZ", "TERM", "TMPDIR", "TMP", "TEMP",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS", "BUN_INSTALL",
  "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "APPDATA", "LOCALAPPDATA", "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
  "SYSTEMDRIVE", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "COMMONPROGRAMFILES", "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE", "OS", "PSMODULEPATH",
]);

export function childEnvironment(parent: Record<string, string | undefined>, secrets: Record<string, string>, devSource: boolean, bedrock: Record<string, string>) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(parent)) {
    // An attached dev source runs in the developer's own shell, where exported variables are expected.
    if (devSource && value !== undefined) { env[key] = value; continue; }
    const upper = key.toUpperCase();
    if (value !== undefined && (allowed.has(upper) || upper.startsWith("LC_"))) env[key] = value;
  }
  return { ...env, ...secrets, ...bedrock };
}
