import { handleRequest } from "../server.mjs";

export default function vercelHandler(req, res) {
  const rewrittenUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const originalPath = rewrittenUrl.searchParams.get("__path");
  if (originalPath) {
    rewrittenUrl.searchParams.delete("__path");
    req.url = `${originalPath}${rewrittenUrl.search}`;
  }
  return handleRequest(req, res);
}
