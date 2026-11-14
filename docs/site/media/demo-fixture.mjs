// Reproducible local-only source for the native plugin release report/media.
import { createServer } from 'node:http';
const server = createServer((request, response) => {
  if (request.url === '/robots.txt') return response.end('User-agent: *\nAllow: /\n');
  response.setHeader('content-type', 'text/html');
  const title = request.url === '/' ? 'Harbor ceramics — local audit fixture' : 'Ceramic travel mugs';
  response.end(`<!doctype html><html lang="en"><head><title>${title}</title></head><body><h1>${request.url === '/' ? 'Harbor ceramics' : 'Ceramic travel mugs'}</h1><p>This local demonstration fixture deliberately repeats page titles and omits descriptions. It is not a client website.</p><a href="/catalog/">Browse mugs</a><a href="/guide/">Care guide</a></body></html>`);
});
server.listen(0, '127.0.0.1', () => {
  console.log(`Local fixture: http://127.0.0.1:${server.address().port}/`);
  console.log('Plan first, then use sitemap:"none", maxPages:3 and respectRobots:true. Ctrl+C stops the fixture.');
});
