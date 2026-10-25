// api-ts/netease.ts

/**
 * Vercel 上的网易云音乐 API 代理入口。
 *
 * 目的：让站点「天然自带」一个登录好的网易云账号，访客打开即已登录。
 *
 * 做法：
 * 1. `vercel.json` 把 `/api/netease/song/detail` rewrite 成 `/api/netease?path=/song/detail`
 *    （扁平入口，和 `api/qq.ts` 同一个原因：frameworkless 项目里嵌套 catch-all 会被当成字面路由）。
 * 2. 本文件把 `path` 还原成后端路径，其余 query 原样透传。
 * 3. 请求里的 `cookie` 参数被环境变量 `NETEASE_COOKIE` **强制覆盖**，于是所有访客都用同一个账号。
 *    环境变量没配时退化为透传（前端自己的 localStorage cookie 生效），不影响未配置的部署。
 * 4. `/logout` 是唯一例外：不注入 cookie。否则任何访客点一下「退出登录」就会把管理员账号的
 *    MUSIC_U 会话在服务端注销掉，桌面端跟着掉线。
 *
 * 环境变量：
 * - `NETEASE_COOKIE`   （必填）网易云登录 cookie，形如 `MUSIC_U=...; __csrf=...`
 * - `NETEASE_UPSTREAM` （可选）上游 NeteaseCloudMusicApi 地址，默认 wyymusicapi.789511.xyz
 *
 * 跑 Edge Runtime：纯 fetch 转发，没有 `node:*` 依赖。注意 Edge 的 `process.env` 是**构建时内联**的，
 * 改了环境变量必须重新部署才生效。
 */

export const config = { runtime: 'edge' };

const DEFAULT_UPSTREAM = 'https://wyymusicapi.789511.xyz';

function buildCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin');
  return {
    // 带上回显 Origin：Capacitor 的 Origin 是 https://localhost，需要精确匹配才能过预检
    'Access-Control-Allow-Origin': origin || '*',
    // 前端（src/services/onlineMusic/netease/netease.ts）用 `credentials: 'include'` 发请求：
    // 跨域时必须同时回这个头，否则浏览器直接丢弃响应，前端只会看到 TypeError（判成「无法连接」）。
    // 有 Origin 时 ACAO 必须是具体来源，因此这里回显 origin 而不是 `*`。
    ...(origin ? { 'Access-Control-Allow-Credentials': 'true' } : {}),
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Accept,X-Requested-With,Cache-Control,Pragma',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Expose-Headers': 'Content-Type,Content-Length',
    Vary: 'Origin',
  };
}

function jsonResponse(request: Request, body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...buildCorsHeaders(request), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: buildCorsHeaders(request) });
  }

  const url = new URL(request.url);
  const params = new URLSearchParams(url.search);
  const path = params.get('path') ?? '/';
  params.delete('path');

  const normalized = path.startsWith('/') ? path : `/${path}`;

  // rewrite 后拿不到原始 pathname，用还原出来的路径判断是否放行 cookie 注入
  const isLogout = normalized === '/logout';

  const injected = typeof process !== 'undefined' && process.env ? process.env.NETEASE_COOKIE : undefined;
  if (injected && !isLogout) {
    params.set('cookie', injected);
  }

  const upstreamBase = (
    (typeof process !== 'undefined' && process.env && process.env.NETEASE_UPSTREAM) || DEFAULT_UPSTREAM
  ).replace(/\/+$/, '');

  const search = params.toString();
  const target = `${upstreamBase}${normalized}${search ? `?${search}` : ''}`;

  const method = request.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';

  const headers: Record<string, string> = {
    accept: request.headers.get('accept') || 'application/json, text/plain, */*',
    'user-agent': request.headers.get('user-agent') || 'Mozilla/5.0 (compatible; FoliaSyncProxy/1.0)',
  };
  const contentType = request.headers.get('content-type');
  if (contentType) headers['content-type'] = contentType;

  try {
    const init: RequestInit = { method, headers, redirect: 'follow' };
    if (hasBody) {
      // 前端 POST 用 x-www-form-urlencoded，body 必须原样透传
      const buf = await request.arrayBuffer();
      if (buf.byteLength > 0) init.body = buf;
    }

    const upstream = await fetch(target, init);
    const buffer = await upstream.arrayBuffer();
    const upstreamType = upstream.headers.get('content-type') || 'application/json; charset=utf-8';

    return new Response(buffer, {
      status: upstream.status,
      headers: {
        ...buildCorsHeaders(request),
        'Content-Type': upstreamType,
        // 账号数据是动态的，别让 Vercel/CDN 缓存住别人的登录态
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return jsonResponse(
      request,
      { code: 502, message: 'Netease upstream unreachable', detail: String(error) },
      502,
    );
  }
}
