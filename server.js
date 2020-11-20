/* eslint-disable no-sync */

const express = require('express');
const Controller = require('./controller.js');
const Model = require('./model.js');
const RdjManager = require('./rdjManager.js');
let models = require('./models');
const helmet = require("helmet");
const https = require('https');
const fs = require('fs');

//globals
const app = express();
let model, processor, rdj;

try{

  let options = {
    key: fs.readFileSync('C:/Certbot/archive/api.ampupradio.com/privkey1.pem'),
    cert: fs.readFileSync('C:/Certbot/archive/api.ampupradio.com/fullchain1.pem'),
  };
  
  https.createServer(options, app).listen(3000);
  console.log('SSL');
}
catch(e){
  app.listen(3000);
  console.log('SSL DISABLED');
}

app.use(helmet());

app.get('/api', function (req, res) {
  const config = {
    apiKey: req.query.apikey,
    action: req.query.action,
    table: req.query.table,
    col: req.query.col,
    db: req.query.db,
    ref: req.query.ref,
    mod1: req.query.mod1,
    limit: parseInt(req.query.limit),
    page: parseInt(req.query.page),
    sortRef: req.query.sortref,
    sortDir: req.query.sortdir
  };

  for(const property of Object.keys(config)){
    if(config[property]){
      config[property] = config[property].split(' ')[0].split('%20')[0];
    }
  }

  processor.setReq(req);
  processor.setRes(res);

  if(Object.keys(models).includes(config.db)){
    processor.setModel(models[config.db]);
  }
  else{
    models.addModel(config.db);
    processor.setModel(models[config.db]);
  }

  (async () => {
    await processor.authenticate(config.apiKey);
    await processor.processRequest(config);
  })();
  
});

app.get('/v2', function (req, res) {
  const config = {
    apiKey: req.query.apikey,
    action: req.query.action,
    entity: req.query.entity,
    identifier: req.query.identifier,
    refs: req.query.refs,
    strict: req.query.strict,
    db: 'radiodj2020',
    limit: parseInt(req.query.limit),
    page: parseInt(req.query.page),
    sortRef: req.query.sortref,
    sortDir: req.query.sortdir
  };

  for(const property of Object.keys(config)){
    if(config[property]){
      config[property] = config[property].split(' ')[0].split('%20')[0];
    }
  }

  processor.setReq(req);
  processor.setRes(res);

  if(Object.keys(models).includes(config.db)){
    processor.setModel(models[config.db]);
  }
  else{
    models.addModel(config.db);
    processor.setModel(models[config.db]);
  }

  (async () => {
    await rdj.processRequest(config);
  })();

});

model = new Model('radiodj2020','sql');
processor = new Controller(model, null, null);
rdj = new RdjManager(processor);

//set up for watchers and background tasks
let hiddenModel = new Model('radiodj2020','sql');
let hiddenProcessor = new Controller(hiddenModel, null, null);
let hiddenRdj = new RdjManager(hiddenProcessor);

//let testModel = new Model('store','nosql');


(async () => {
  await hiddenRdj.initWatchers();
  
  hiddenRdj.watchers.add('history');
  hiddenRdj.watchers.add('songs');
  
  //testModel.watch('images');
})();
