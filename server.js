const express = require('express');
const Controller = require('./controller.js');
const Model = require('./model.js');
const RdjManager = require('./rdjManager.js');
const dbTypes = require('./dbTypes.json');

//globals
const app = express();
let model,processor,rdj;

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


  if (model.dbName != config.db) {
    model.setDb(config.db,dbTypes[config.db]);
  }

  (async () => {
    await processor.authenticate(config.apiKey);
    await processor.processRequest(config);
    //res.json(res);
  })();

  //let processor = new Controller();
  // controller.processRequest();
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

  if (model.dbName != config.db) {
    model.setDb(config.db,dbTypes[config.db]);
  }

  (async () => {
    await rdj.processRequest(config);

  })();

  //let processor = new Controller();
  // controller.processRequest();
});



model = new Model('radiodj2020_-_sql');
processor = new Controller(model, null, null);
rdj = new RdjManager(processor);

app.listen(3000);

//set up for watchers and background tasks
let hiddenModel = new Model('radiodj2020_-_sql');
let hiddenProcessor = new Controller(hiddenModel, null, null);
let hiddenRdj = new RdjManager(hiddenProcessor);

(async () => {
  await hiddenRdj.initWatchers();
  hiddenRdj.watchers.add('history');
  hiddenRdj.watchers.add('songs');
  //await rdj.watchers.add('queuelist');
  //rdj.watchers.removeAll();
})();
