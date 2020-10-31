const Model = require('./model');


let models = {
  lookUpTable: {
    'radiodj2020': 'sql',
    'store': 'nosql'
  },
  addModel(db) {
    let dbType = this.lookUpTable[db];
    let model = new Model(`${db}_-_${dbType}`);
    this[db] = model;
  },
}


module.exports = models;