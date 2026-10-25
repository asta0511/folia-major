import {
    SegmentationRequestError,
    readSegmentationLines,
    segmentLyricLines,
} from '../shared/lyricSegmentationService.mjs';

// 当前文件：Vercel 歌词分词函数的 TypeScript 源文件。
// 与主题生成不同，这里只有一个端点：provider 在 shared/lyricSegmentationService.mjs 内部按
// 部署配置的 env 分支，客户端不需要知道服务端接的是哪家模型。
export const config = {
    runtime: 'edge',
};

// 跨域头：Capacitor/APK 里页面的 Origin 是 https://localhost，调用本站的 /api/* 属于跨域。
// 这里不涉及 cookie（前端不带凭据），所以 `*` 足够；但必须在响应和预检里都出现，否则 WebView 直接拦截。
const CORS_HEADERS: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
};

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
});

export default async function handler(req: Request) {
    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (req.method !== 'POST') {
        return json({ error: 'Method Not Allowed' }, 405);
    }

    try {
        const lines = readSegmentationLines(await req.json());
        const segmented = await segmentLyricLines(lines, process.env);
        return json({ lines: segmented }, 200);
    } catch (error) {
        const status = error instanceof SegmentationRequestError ? error.status : 500;
        const message = error instanceof Error ? error.message : 'Internal Server Error';
        console.error('Error segmenting lyrics:', message);
        return json({ error: message }, status);
    }
}
