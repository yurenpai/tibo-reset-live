const fs=require('node:fs');
const path=require('node:path');

const directory=path.resolve(__dirname,'../../.artifacts/qa');
fs.mkdirSync(directory,{recursive:true});
module.exports=name=>path.join(directory,name);
