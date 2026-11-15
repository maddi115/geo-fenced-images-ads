// DEV ONLY: prints a line in the `npm run dev` terminal (see vite.config.js), so it can be copied.
// tag = the label in front, e.g. 'jxl stats' -> [jxl stats 4:42:10 PM] ...
export function devLog(tag: string, text: string) {
  if (!import.meta.env.DEV) return;
  console.info(`[${tag}] ${text}`);
  fetch(`/__dev-log?tag=${encodeURIComponent(tag)}`, { method: 'POST', body: text }).catch(() => {});
}
