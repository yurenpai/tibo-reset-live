import {startServer} from './server.js';
// 即使 .env 曾配置云部署，本地入口也只允许本机访问；不要求 X/VAPID 凭证。
startServer({...process.env,LOCAL_MODE:'1',HOST:'127.0.0.1',PUBLIC_ORIGIN:`http://localhost:${Number(process.env.PORT)||8788}`});
