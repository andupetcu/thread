export async function api(path, options = {}) {
  const headers = { "X-Thread-Request": "1", ...options.headers };
  if (
    options.body !== undefined &&
    !(options.body instanceof Blob) &&
    !(options.body instanceof ArrayBuffer)
  ) {
    headers["Content-Type"] = "application/json";
    options = { ...options, body: JSON.stringify(options.body) };
  }
  const response = await fetch("/api" + path, { ...options, headers });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = Object.assign(
      new Error(data.error || `Request failed (${response.status})`),
      data,
      { status: response.status },
    );
    throw error;
  }
  return response.headers.get("Content-Type")?.includes("application/json")
    ? response.json()
    : response.blob();
}
