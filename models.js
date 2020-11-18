const Model = require('./model');


let models = {
  lookUpTable: {
    'radiodj2020': 'sql',
    'store': 'nosql'
  },
  addModel(db) {
    let dbType = this.lookUpTable[db];
    this[db] = new Model(`${db}`,`${dbType}`);
  },
}


module.exports = models;