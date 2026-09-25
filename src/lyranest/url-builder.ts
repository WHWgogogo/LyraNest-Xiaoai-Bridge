export function buildStreamUrl(
  speakerBaseUrl: string,
  trackId: string,
  mediaToken: string,
  transcode?: string,
): string {
  const base = (speakerBaseUrl || "").replace(/\/+$/, "");
  let url = `${base}/api/v1/tracks/${encodeURIComponent(trackId)}/stream?access_token=${encodeURIComponent(mediaToken)}`;
  if (transcode && transcode !== "never" && transcode !== "original" && transcode !== "auto") {
    url += `&transcode=${encodeURIComponent(transcode)}`;
  }
  return url;
}
