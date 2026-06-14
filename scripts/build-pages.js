import { mkdir, readFile, writeFile } from "node:fs/promises";

const markdown = await readFile("README.md", "utf8");
const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>@async/claims</title>
<style>
body{font-family:ui-sans-serif,system-ui,sans-serif;margin:0;color:#17202a;background:#f8fafc}
main{max-width:980px;margin:0 auto;padding:40px 20px}
pre{white-space:pre-wrap;line-height:1.5;background:white;border:1px solid #d8e0e8;border-radius:8px;padding:24px;overflow:auto}
</style>
<main><pre>${escapeHtml(markdown)}</pre></main>
</html>
`;

await mkdir(".async/pages", { recursive: true });
await writeFile(".async/pages/index.html", html);

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
