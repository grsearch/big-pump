// Resolve only when a request runs; importing/rendering this module is SSR-safe.
export function collectorApiBase(hostname?: string): string {
  const host = hostname ?? (typeof window === 'undefined' ? '' : window.location.hostname);
  return ['localhost', '127.0.0.1'].includes(host) ? 'http://127.0.0.1:5010/api' : '/api';
}

export async function collectorRequest(path: string, body?: unknown): Promise<any> {
  if (!path.startsWith('/') || path.startsWith('//')) throw Error('无效 API 路径');
  const hasBody = body !== undefined;
  const res = await fetch(collectorApiBase() + path, {
    method: hasBody ? 'POST' : 'GET',
    headers: hasBody ? {'Content-Type': 'application/json'} : undefined,
    body: hasBody ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 401) throw Error('访问认证失败，请刷新页面并重新登录');
  const json = await res.json().catch(() => { throw Error(`API 返回无效响应（HTTP ${res.status}），请检查反向代理`); });
  if (!res.ok) {
    const message = json && typeof json === 'object' && 'error' in json && typeof json.error === 'string' ? json.error : `请求失败（HTTP ${res.status}）`;
    throw Error(message);
  }
  return json;
}
