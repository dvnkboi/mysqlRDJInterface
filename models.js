const Model = require('./model');


let models = {
    addModel(db){
        model = new Model(db);
        this[db] = model;
        this[db].eventHandler.event.on('died',() => {
          delete this[db];
        });
    }
}


module.exports = models;