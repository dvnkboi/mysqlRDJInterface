const Model = require('./model');


let models = {
  lookUpTable: {
    'radiodj2020': 'sql',
    'store': 'nosql'
  },
  addModel(db) {
    let dbType = this.lookUpTable[db];
    model = new Model(`${db}_-_${dbType}`);
    this[db] = model;
    this[db].eventHandler.event.on('died', () => {
      delete this[db];
    });
  }
}


module.exports = models;