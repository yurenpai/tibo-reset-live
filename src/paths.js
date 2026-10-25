import {fileURLToPath} from 'node:url';

// 所有入口共用项目根目录；数据库与 .env 不随源码目录迁移。
export const projectRoot=fileURLToPath(new URL('../',import.meta.url));
