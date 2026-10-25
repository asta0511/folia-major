#!/usr/bin/env python3
"""给 api-ts/generate-theme_openai.ts 重新应用 Capacitor CORS 补丁。

用途：同步上游后，上游的 generate-theme_openai.ts 会覆盖掉 fork 里的 CORS 补丁
（因为上游也大改了同一个文件）。本脚本在该文件的新版本上重新注入：
  1) buildCorsHeaders / jsonResponse 两个 helper
  2) handler 开头的 OPTIONS -> 204 分支
  3) 所有 new Response(JSON.stringify(...), { status, headers }) 改走 jsonResponse

脚本幂等：已包含 buildCorsHeaders 时直接退出 0。
"""
import re
import sys

TARGET = sys.argv[1] if len(sys.argv) > 1 else 'api-ts/generate-theme_openai.ts'

HELPERS = '''
// ---------------------------------------------------------------------------
// [PATCH] Capacitor 安卓端 CORS 支持
// 安卓 WebView 页面源为 https://localhost，属跨域请求，必须显式放行；
// 浏览器同源访问（无 Origin 头）行为保持不变。
const buildCorsHeaders = (req: Request): Record<string, string> => {
    const origin = req.headers.get('origin');
    if (!origin) {
        return {};
    }
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Vary': 'Origin',
    };
};
const jsonResponse = (req: Request, body: unknown, status: number): Response => new Response(
    JSON.stringify(body),
    {
        status,
        headers: {
            'Content-Type': 'application/json',
            ...buildCorsHeaders(req),
        },
    },
);
// ---------------------------------------------------------------------------

'''

OPTIONS_BRANCH = '''    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: buildCorsHeaders(req) });
    }
'''


def find_matching(src: str, open_idx: int) -> int:
    """从 src[open_idx]（必须是左括号）开始，返回匹配的右括号下标。"""
    pairs = {'(': ')', '[': ']', '{': '}'}
    opener = src[open_idx]
    closer = pairs[opener]
    depth = 0
    i = open_idx
    quote = None
    while i < len(src):
        ch = src[i]
        if quote:
            if ch == '\\':
                i += 2
                continue
            if ch == quote:
                quote = None
        else:
            if ch in ('"', "'", '`'):
                quote = ch
            elif ch == opener:
                depth += 1
            elif ch == closer:
                depth -= 1
                if depth == 0:
                    return i
        i += 1
    raise ValueError('unbalanced brackets')


def rewrite_responses(src: str) -> tuple[str, int]:
    needle = 'new Response(JSON.stringify('
    count = 0
    pos = 0
    while True:
        idx = src.find(needle, pos)
        if idx == -1:
            break
        arg_open = idx + len('new Response(') + len('JSON.stringify')  # JSON.stringify 的 '(' 位置
        args_close = find_matching(src, arg_open)      # JSON.stringify(...) 结束
        expr = src[arg_open + 1:args_close]
        tail = src[args_close + 1:]
        m = re.match(r'\s*,\s*\{', tail)
        if not m:
            pos = idx + len(needle)
            continue
        options_open = args_close + 1 + m.end() - 1
        options_close = find_matching(src, options_open)
        options = src[options_open:options_close + 1]
        status_m = re.search(r'status:\s*(\d+)', options)
        status = status_m.group(1) if status_m else '200'
        call_open = idx + len('new Response')
        call_close = find_matching(src, call_open)
        src = src[:idx] + f'jsonResponse(req, {expr}, {status})' + src[call_close + 1:]
        count += 1
        pos = idx + len('jsonResponse(req, ')
    return src, count


def main() -> int:
    with open(TARGET, 'r', encoding='utf-8') as fh:
        src = fh.read()

    if 'buildCorsHeaders' in src:
        print(f'[skip] {TARGET} 已包含 CORS 补丁')
        return 0

    anchor = 'export default async function handler'
    if anchor not in src:
        print(f'[error] 找不到 handler 入口，文件结构可能变化较大: {TARGET}', file=sys.stderr)
        return 1

    src = src.replace(anchor, HELPERS.lstrip('\n') + anchor, 1)

    # handler 开头插入 OPTIONS 分支
    handler_idx = src.index(anchor)
    brace_idx = src.index('{', handler_idx)
    src = src[:brace_idx + 1] + '\n' + OPTIONS_BRANCH + src[brace_idx + 1:]

    src, count = rewrite_responses(src)

    with open(TARGET, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(src)

    print(f'[ok] {TARGET}: 注入 helper + OPTIONS 分支，改写 {count} 处响应')
    return 0


if __name__ == '__main__':
    sys.exit(main())
