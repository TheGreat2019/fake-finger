import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json'};
export function startServer(port=8000){
  return new Promise(resolve=>{
    const cacheHits=new Map();
    const server=http.createServer(async(req,res)=>{
      try{
        const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
        if(pathname==='/cache-fixture'){
          const key=req.headers.host;const count=(cacheHits.get(key)||0)+1;cacheHits.set(key,count);
          res.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'public, max-age=3600'});res.end(String(count));return;
        }
        if(pathname==='/clean-test-worker.js'){
          res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});
          res.end("self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));");return;
        }
        if(pathname==='/headers'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(req.headers));return;}
        const file=path.resolve(root,'.'+(pathname==='/'?'/diagnostic.html':pathname));
        if(!file.startsWith(root) || !['.html','.js','.css','.json'].includes(path.extname(file))){res.writeHead(403);res.end();return;}
        res.writeHead(200,{'Content-Type':mime[path.extname(file)],'Cache-Control':'no-store'});res.end(await readFile(file));
      }catch{if(!res.headersSent)res.writeHead(404);res.end('Not found');}
    });
    server.listen(port,'127.0.0.1',()=>resolve(server));
  });
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const server=await startServer();console.log(`检测页：http://localhost:${server.address().port}/diagnostic.html\n仅监听本机。按 Ctrl+C 停止。`);
}
