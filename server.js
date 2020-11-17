const express = require('express');
const Controller = require('./controller.js');
const Model = require('./model.js');
const RdjManager = require('./rdjManager.js');
let models = require('./models');

//globals
const app = express();
let model, processor, rdj;

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

model = new Model('radiodj2020_-_sql');
processor = new Controller(model, null, null);
rdj = new RdjManager(processor);

app.listen(3000);

//set up for watchers and background tasks
let hiddenModel = new Model('radiodj2020_-_sql');
let hiddenProcessor = new Controller(hiddenModel, null, null);
let hiddenRdj = new RdjManager(hiddenProcessor);
let testModel = new Model('store_-_nosql');


(async () => {
  await hiddenRdj.initWatchers();
  hiddenRdj.watchers.add('history');
  hiddenRdj.watchers.add('songs');
  testModel.watch('images');
})();
