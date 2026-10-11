export function matchesPublicRoute(keys: readonly string[], method: string, pathname: string) {
  if (pathname === "/_bedrock" || pathname.startsWith("/_bedrock/")) return false;
  const segments = pathname.split("/");
  return keys.some(key => {
    const [registeredMethod, path] = key.split(" ");
    if (registeredMethod !== method && !(method === "HEAD" && registeredMethod === "GET")) return false;
    const pattern = path!.split("/");
    return pattern.length === segments.length && pattern.every((segment, index) =>
      segment.startsWith(":") ? segments[index] !== "" : segment === segments[index]);
  });
}
