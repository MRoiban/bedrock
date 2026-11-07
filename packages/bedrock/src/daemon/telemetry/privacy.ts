import { matchesPublicRoute } from "../public-routes";
// Unknown segments are all collapsed: names, slugs and emails can be just as private as numeric IDs.
export function routeShape(method: string, path: string, publicRoutes: string[] = []) {
  const known = publicRoutes.find(key => matchesPublicRoute([key], method, path));
  return known && known.length <= 256 ? known : (path === "/" ? "/" : "/" + path.split("/").filter(Boolean).slice(0, 8).map(() => ":segment").join("/"));
}
export function requestMethod(method: string) { return ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "CONNECT", "TRACE"].includes(method) ? method : "_OTHER"; }
