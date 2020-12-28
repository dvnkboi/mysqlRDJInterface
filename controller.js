/* eslint-disable no-process-env */
let allowed = {};
const { promises: fs } = require("fs");

require('dotenv').config();


class Controller {

    constructor(model, req, res) {
        this.model = model;
        this.req = req;
        this.res = res;
        this.allowed = false;
        this.blackListed = false;
        this.api = process.env.API_KEY;
        this.eventHandler = model.eventHandler.event;
    }

    async authenticate(api) {
        try{
            if (api === this.api && allowed.databases.includes(this.model.dbName)) {
                this.allowed = true;
            }
            else {
                this.allowed = false;
            }
        }
        catch(e){
            allowed = JSON.parse(await fs.readFile('./allowed.json', { encoding :'utf-8' }));
            await this.authenticate(api);
        }
    }

    async getRows(config) {

        //handling pagination and sorting
        if (config.limit) {
            this.model.limit = config.limit;
        }
        else {
            this.model.limit = null;
        }
        if (config.page) {
            this.model.offset = parseInt(config.page * config.limit);
        }
        else {
            this.model.offset = 0;
        }
        if (config.sortDir && config.sortRef) {
            this.model.sortRef = config.sortRef;
            this.model.sortDir = config.sortDir;
        }
        else {
            this.model.sortRef = null;
            this.model.sortDir = null;
        }

        let result = {};
        try {
            if (config.action === 'get') {
                result.job = 'GET';
                result.query = config.ref;
                if (config.table) {
                    if (config.col) {
                        if (config.ref) {

                            if (config.mod1 == "true" || config.mod1 == "false") {
                                result.resultSet = await this.model.getMatching(config.table, config.col, config.ref, config.mod1);
                                result.numOfRows = result.resultSet ? result.resultSet.length : 0;
                            }
                            else {
                                result.resultSet = await this.model.getMatching(config.table, config.col, config.ref, false);
                                result.numOfRows = result.resultSet ? result.resultSet.length : 0;
                            }
                        }
                        else {
                            this.sendError(400, 'incomplete request');
                            return;
                        }
                    }
                    else {
                        result.resultSet = await this.model.getAll(config.table);
                        result.found = await this.model.getNumOfRows(config.table);
                        result.numOfRows = result.resultSet ? result.resultSet.length : 0;
                    }
                }
                else {
                    result.resultSet = await this.model.getTables();
                    result.numOfRows = result.resultSet ? result.resultSet.length : 0;
                    //this.sendError(500, 'incomplete request');
                    //return;
                }
            }
            else if (config.action === 'update') {
                result.job = 'UPDATE';
                this.sendError(500, 'missing implementation');
            }
            else if (config.action === 'delete') {
                result.job = 'DELETE';
                this.sendError(500, 'missing implementation');
            }
            else {
                this.sendError(400, 'invalid action');
                return;
            }
            return result;
        }
        catch (err) {
            console.error(err);
            this.sendError(500, 'unhandled exception');
            return;
        }
    }

    sendError(status, msg) {
        try {
            this.res.status(status);
            this.res.json({
                status: this.res.statusCode,
                error: msg
            });
        }
        catch (e) {

        }
    }

    sendJSON(res) {
        try {
            this.res.status(200);
            this.res.json(res);
        }
        catch (e) {

        }
    }

    async processRequest(config) {
        let processTime = Date.now();
        let result = {};
        result.reqDate = new Date().toJSON();

        result.caller = await this.manageBlackList(config.apiKey);

        result.response = await this.getRows(config);

        if (result.numOfRows < 1) {
            result.resultSet = null;
        }
        if (result.found) {
            delete result.found;
        }
        result.timeTaken = Date.now() - processTime + 'ms';
        this.sendJSON(result);
    }

    async manageBlackList(api){
        let caller = await this.getCaller();
        if (this.blackListed) {
            this.sendError(403, 'blackListed');
            return;
        }

        await this.authenticate(api);
        if (!this.allowed) {
            this.sendError(403, 'unauthorized');
            if(allowed.infringments[caller]){
                allowed.infringments[caller]++;
            }
            else{
                allowed.infringments[caller]=1;
            }
            if(allowed.infringments[caller] >= 3){
                if(!allowed.blackList.includes(caller)){
                    allowed.blackList.push(caller);
                }
                let timedOutCaller = caller;
                let whiteList = (timedOutCaller) => {
                    setTimeout(async () => {
                        delete allowed.infringments[timedOutCaller];
                        allowed.blackList = allowed.blackList.filter(e => e !== timedOutCaller);
                        await fs.writeFile('allowed.json', JSON.stringify(allowed), 'utf8');
                        // eslint-disable-next-line no-empty-function
                        allowed = JSON.parse(await fs.readFile('./allowed.json', { encoding :'utf-8' }));
                    },3600000);
                }
                whiteList(timedOutCaller,allowed);
            }

            await fs.writeFile('allowed.json', JSON.stringify(allowed), 'utf8');

            // eslint-disable-next-line no-empty-function
            allowed = JSON.parse(await fs.readFile('./allowed.json', { encoding :'utf-8' }));
            return null;
        }
        return caller;
    }

    async getCaller() {
        allowed = JSON.parse(await fs.readFile('./allowed.json', { encoding :'utf-8' }));
        let caller = this.req.headers['x-forwarded-for'] ||
                    this.req.connection.remoteAddress ||
                    this.req.socket.remoteAddress ||
                    (this.req.connection.socket ? this.req.connection.socket.remoteAddress : null);
        if(allowed.blackList.includes(caller)){
            this.blackListed = true;
            console.log('refused req from',caller);
        }
        else{
            this.blackListed = false;
        }
        return caller;
    }

    async watch(schema) {
        try {
            await this.model.watch(schema);
        }
        catch (e) {
            console.error(e);
        }
    }

    async unwatch(schema) {
        try {
            await this.model.unwatch(schema);
        }
        catch (e) {
            console.error(e);
        }
    }

    async getOne(table, idCol, id) {
        if (table && idCol && id) {
            let result = await this.model.getMatching(table, idCol, id, true);
            result = result['0'];
            return result;
        }
        else {
            return null;
        }
    }

    async getAll(table) {
        if (table) {
            let result = await this.model.getAll(table);
            //result = result['0'];
            return result;
        }
        else {
            return null;
        }
    }

    setModel(model) {
        this.model = model;
    }

    setRes(res) {
        this.res = res;
    }

    setReq(req) {
        this.req = req;
    }

}


module.exports = Controller;