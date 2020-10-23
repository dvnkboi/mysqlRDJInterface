const utils = require('./utils');
const moment = require('moment-timezone');

class RdjManager {

    constructor(controller) {
        this.controller = controller;
        this.songPreload = null;
        this.watchers;
    }

    async initWatchers(){
        let proxy = this;
        this.watchers = {
            async add(table){
                if(table == 'history'){
                    this.watchedSchemas.push('radiodj2020.history.*');
                    await proxy.watchHistory();
                }
                else{
                    this.watchedSchemas.push(`radiodj2020.${table}.*`);
                    await proxy.generalWatcher(table);
                }
            },
            async removeAll(){
                proxy.controller.eventHandler.removeAllListeners(); 
                for(const schema of proxy.watchers.watchedSchemas){
                    await proxy.controller.unwatch(schema);
                }
                console.log('all events removed');
            },
            watchedSchemas: []
        }
    }

    async processRequest(config) {
        this.controller.authenticate(config.apiKey);
        let proxy = this;
        let result = {
            response: []
        };

        let processTime = Date.now();
        result.reqDate = new Date().toJSON();

        result.caller = this.controller.getCaller();
        this.config = {
            apiKey: config.apiKey,
            action: config.action,
            table: config.entity,
            col: config.identifier,
            db: config.db,
            mod1: config.strict,
            limit: config.limit,
            page: config.page,
            sortRef: config.sortRef,
            sortDir: config.sortDir
        };

        if (config.action == 'get') {
            let element = [];
            if (config.refs) {
                let refs = config.refs.split(',');
                let done = [];
                this.config.limit = null;
                this.config.page = null;
                // this.config.sortRef = null;
                // this.config.sortDir = null;

                for (const el of refs) {
                    if (el && !done.includes(el)) {
                        proxy.config.ref = el;
                        done.push(el);
                        element = await proxy.controller.getRows(proxy.config);
                        if (element.resultSet.length >= 1) {
                            result.response.push(element);
                        }
                        else {
                            result.response.push({ resultSet: 'could not find element with reference: ' + el });
                        }
                    }
                }
            }
            else {
                try{
                    result.response = await proxy.controller.getRows(proxy.config);
                    result.found = result.response.found;
                    delete result.response['found'];
                }
                catch(e){
                    console.error('result has no attribute found');
                    return;
                }
            }
        }


        if (Array.isArray(result.response)) {
            result.found = result.response.length;

            if (config.limit) {
                if (!config.page) {
                    config.page = 0;
                }
                if (config.page * config.limit > result.response.length) {
                    result.response = [];
                }
                else {
                    result.response = result.response.filter(function (value, index, arr) {
                        return (index >= config.page * config.limit && index < config.page * config.limit + parseInt(config.limit));
                    });
                }
            }

        }
        try{
            if (!result.response.length < 1 || utils.isEmpty(result.response)) {
                result.response.resultSet = null;
            }
        }
        catch(e){
            console.error('result has no length');
            return;
        }

        result.timeTaken = Date.now() - processTime + 'ms';
        this.controller.res.json(result);

    }

    async watchHistory() {
        await this.controller.watch('radiodj2020.history.*');
        let eta = await this.timeToNext();
        console.log(utils.formatedTime(eta/1000),'to next song');

        if (this.songPreload != null) {
            clearTimeout(this.songPreload);
            this.songPreload = null;
        }

        this.songPreload = setTimeout(() => {
            console.log('start preload');
        }, eta - 10000);

        return this.controller.eventHandler.on('history', async (event) => {
            eta = await this.timeToNext();
            console.log(event.type, event.table, utils.formatedTime(eta/1000),'song changed');

            if (this.songPreload != null) {
                clearTimeout(this.songPreload);
                this.songPreload = null;
            }

            this.songPreload = setTimeout(() => {
                console.log('start preload');
            }, eta - 10000);

        });
        
    }

    async generalWatcher(table){
        await this.controller.watch(`radiodj2020.${table}.*`);

        return this.controller.eventHandler.on(table, (event) => {
            if (event.type == 'INSERT') {
                console.log('add event ',event.table,event.affectedColumns ,event.affectedRows[0].after.ID);
            }
            else if (event.type == 'DELETE') {
                console.log('remove event ',event.table,event.affectedColumns ,event.affectedRows[0].before.ID);
            }
            else if (event.type == 'UPDATE') {
                console.log('update event ',event.table,event.affectedColumns ,event.affectedRows[0].before.ID);
            }
            else {
                console.error('unhandled event ', event.type);
            }
        });
    }

    async getNextSong(){
        let result = await this.controller.getOne('queuelist','ID',1);
        return result;
    }

    async timeToNext(){
        let nextSong = await this.getNextSong();
        nextSong.ETA = moment(nextSong.ETA).local().valueOf();
        let eta = nextSong.ETA - moment().local().valueOf();
        return eta;
    }

    setController(controller){
        this.controller = controller;
    }

}


module.exports = RdjManager;