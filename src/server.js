'use strict';
const {makeApp}=require('./app');
const path=require('node:path');
const port=Number(process.env.PORT||3000);
const dbPath=process.env.DB_PATH||path.join(__dirname,'../data/database.json');
const {server}=makeApp({dbPath});
server.listen(port,()=>console.log(`Sistema de frequência: http://localhost:${port}`));
