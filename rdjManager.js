const utils = require('./utils');
const moment = require('moment-timezone');
const MBA = require('./MBA');
const { EventEmitter } = require("events");

class RdjManager {

    constructor(controller) {
        this.controller = controller;
        this.songPreload = null;
        this.watchers;
        this.API = {
            mba: new MBA(),
            buffer: {},
            timeout: null,
            flushAfter: 5000,
            rowsToFlush: 0,
            busy:false,
            retries:5,
            retriesRemaining:5,
            status:'initialized',
            retryTimeout:null,
            action:'none', 
            current:0,
            total:0
        };
        this.API.event= this.API.mba.events.event;
        this.API.event.on('next',(res) => {
            this.API.current = res.current;
            this.API.total = res.total;
        });
        this.queue={
            event: new EventEmitter(),
            next: null,
            previous: null,
            history: null
        }
    }

    async initWatchers() {
        let proxy = this;
        this.watchers = {
            async add(table) {
                if (table == 'history') {
                    this.watchedSchemas.push('radiodj2020.history.*');
                    await proxy.watchHistory();
                }
                else if (table == 'songs') {
                    this.watchedSchemas.push(`radiodj2020.songs.*`);
                    await proxy.watchSongs();
                }
                else {
                    this.watchedSchemas.push(`radiodj2020.${table}.*`);
                    await proxy.generalWatcher(table);
                }
            },
            async removeAll() {
                proxy.controller.eventHandler.removeAllListeners();
                for (const schema of proxy.watchers.watchedSchemas) {
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
                try {
                    result.response = await proxy.controller.getRows(proxy.config);
                    result.found = result.response.found;
                    delete result.response['found'];
                }
                catch (e) {
                    console.error('result has no attribute found');
                    return;
                }
            }
        }
        else if(config.action == 'update_meta'){
            result.response = await this.updateMeta();
        }
        else if(config.action == 'update_artwork'){
            result.response = await this.updateArtwork();
        }
        else if(config.action == 'get_status'){
            result.response = await this.getStatus();
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
                    result.response = result.response.filter(function (value, index) {
                        return (index >= config.page * config.limit && index < config.page * config.limit + parseInt(config.limit));
                    });
                }
            }

        }
        try {
            if (!result.response.length < 1 || utils.isEmpty(result.response)) {
                result.response.resultSet = null;
            }
        }
        catch (e) {
            console.error('result has no length');
            return;
        }

        result.timeTaken = Date.now() - processTime + 'ms';

        if(!this.controller.res.headersSent){
            this.controller.res.json(result);
        }
    }

    async getHistory(){
        let tmpLimit = this.controller.model.limit;
        let tmpoffset = this.controller.model.offset;
        this.controller.model.limit = 10;
        this.controller.model.offset = 0;
        this.queue.history = await this.controller.model.getAll('history');
        this.queue.previous = this.queue.history[0];
        this.controller.model.limit = tmpLimit;
        this.controller.model.offset = tmpoffset;
    }

    async watchHistory() {
        await this.controller.watch('radiodj2020.history.*');
        await this.getHistory();
        let eta = await this.timeToNext();
        if(eta > 0){
            console.log(utils.formatedTime(eta / 1000), 'to next song');
        }

        if (this.songPreload != null) {
            clearTimeout(this.songPreload);
            this.songPreload = null;
        }
        
        if(eta - 10000 > 0){
            this.songPreload = setTimeout(() => {
                this.queue.event.emit('preload',this.queue.next);
            }, eta - 10000);
        }

        return this.controller.eventHandler.on('history', async (event) => {
            eta = await this.timeToNext();
            await this.getHistory();
            this.queue.event.emit('song changed',this.queue);
            if (this.songPreload != null) {
                clearTimeout(this.songPreload);
                this.songPreload = null;
            }

            if(eta - 10000 > 0){
                this.songPreload = setTimeout(() => {
                    this.queue.event.emit('preload',this.queue.next);
                }, eta - 10000);
            }
        });

    }

    initSongEvents(){
        this.queue.event.on('preload',(next) => {
            console.log(next);
        });
        this.queue.event.on('song changed',(event) => {
            console.log(event.next);
        });
    }

    async watchSongs() {
        let proxy = this;
        await this.controller.watch(`radiodj2020.songs.*`);
        this.controller.eventHandler.on('songs', async (event) => {
            if (event.type == 'INSERT') {
                console.log('song added ', `${event.affectedRows[0].after.artist} - ${event.affectedRows[0].after.title} (${event.affectedRows[0].after.album})`);
                try{
                    proxy.API.buffer[event.affectedRows[0].after.artist].push(event.affectedRows[0].after.album);
                    proxy.API.rowsToFlush++;
                }
                catch(e){
                    proxy.API.buffer[event.affectedRows[0].after.artist] = [];
                    proxy.API.buffer[event.affectedRows[0].after.artist.trim()].push(event.affectedRows[0].after.album);
                    proxy.API.rowsToFlush++;
                }
                
                if (proxy.API.timeout != null) {
                    clearTimeout(proxy.API.timeout);
                    proxy.API.timeout = null;
                }
                proxy.API.timeout = setTimeout(async () => {
                    await this.flushBufferToMeta();
                }, proxy.API.flushAfter);
            }
            else if (event.type == 'DELETE') {
                console.log('remove event ', event.table, event.affectedColumns, event.affectedRows[0].before.ID);
            }
            else if (event.type == 'UPDATE') {
                //console.log('song updated ', event.table, event.affectedColumns, event.affectedRows[0].before.ID);
            }
            else {
                console.error('unhandled event ', event.type);
            }
        });
    }

    async generalWatcher(table) {
        await this.controller.watch(`radiodj2020.${table}.*`);

        return this.controller.eventHandler.on(table, (event) => {
            if (event.type == 'INSERT') {
                console.log('add event ', event.table, event.affectedColumns, event.affectedRows[0].after.ID);
            }
            else if (event.type == 'DELETE') {
                console.log('remove event ', event.table, event.affectedColumns, event.affectedRows[0].before.ID);
            }
            else if (event.type == 'UPDATE') {
                console.log('update event ', event.table, event.affectedColumns, event.affectedRows[0].before.ID);
            }
            else {
                console.error('unhandled event ', event.type);
            }
        });
    }

    async flushBufferToMeta(){
        if(this.API.busy){
            if(this.API.retriesRemaining > 0 && this.API.status != "server busy"){
                this.API.retriesRemaining--;
                this.API.status = 'retrying';
                console.log('retrying');
                this.API.retryTimeout = setTimeout(async () => this.flushBufferToMeta(),5000);
            }
            else{
                if (this.API.retryTimeout != null) {
                    clearTimeout(this.API.retryTimeout);
                    this.API.retryTimeout = null;
                }
                this.API.status = 'server busy';
                console.log('server busy try again later');
            }
        }
        else{
            this.API.busy = true;
            console.log('flushing ',this.API.rowsToFlush);
            this.API.total = this.API.rowsToFlush;
            await this.API.mba.getMultipleReleases(this.API.buffer);
            if (this.API.retryTimeout != null) {
                clearTimeout(this.API.retryTimeout);
                this.API.retryTimeout = null;
            }
            this.API.buffer = {};
            this.API.rowsToFlush = 0;
            this.API.total = 0;
            this.API.retriesRemaining = this.API.retries;
            this.API.status = 'job completed';
            setTimeout(() => {
                this.API.busy = false;
            },5000);
            console.log('job done');
        }
    }

    async updateMeta(){
        this.API.action = 'update metadata';
        this.API.status = 'started';
        if(!this.controller.res.headersSent){
            this.controller.res.json({
                action: this.API.action,
                songsProcessed: 'all',
                status: this.API.status
            });
        }
        let songs = await this.controller.getAll('songs');
        this.API.buffer = {};
        let proxy = this;
        for(const song of songs){
            //console.log('song added ', `${song.artist} - ${song.title} (${song.album})`);
            try{
                proxy.API.buffer[song.artist].push(song.album);
                
            }
            catch(e){
                proxy.API.buffer[song.artist] = [];
                proxy.API.buffer[song.artist.trim()].push(song.album);
            }
        }
        await this.flushBufferToMeta();
        return {
            action: this.API.action,
            songsProcessed: songs.length,
            status:this.API.status
        };
    }

    async updateArtwork(){
        let res;
        this.API.action = 'update artwork';
        this.API.status = 'started';
        if(this.API.busy){
            if(this.API.retriesRemaining > 5 && this.API.status != "server busy"){
                this.API.retriesRemaining--;
                this.API.status = 'retrying';
                console.log('retrying');
                this.API.retryTimeout = setTimeout(async () => this.updateArtwork(),5000);
            }
            else{
                if (this.API.retryTimeout != null) {
                    clearTimeout(this.API.retryTimeout);
                    this.API.retryTimeout = null;
                }
                this.API.status = 'server busy';
                console.log('server busy try again later');
                return {
                    action: this.API.action,
                    songsProcessed: res,
                    status:'server busy'
                };
            }
        }
        else{
            this.API.busy = true;
            if(!this.controller.res.headersSent){
                this.controller.res.json({
                    action: this.API.action,
                    songsProcessed: 'all',
                    status: this.API.status
                });
            }
            res = await this.API.mba.getAllReleaseGroupImgs();
            console.log('flushing', res);
            if (this.API.retryTimeout != null) {
                clearTimeout(this.API.retryTimeout);
                this.API.retryTimeout = null;
            }
            this.API.buffer = {};
            this.API.rowsToFlush = 0;
            this.API.retriesRemaining = this.API.retries;
            this.API.status = 'job completed';
            setTimeout(() => {
                this.API.busy = false;
            },5000);
            console.log('job done');
        }
        return {
            action: this.API.action,
            songsProcessed: res,
            status:'job done'
        };
    }

    async getStatus(){
        return {
            action: this.API.action,
            status: this.API.status,
            current:this.API.current,
            total: this.API.total
        };
    }

    async getNextSong() {
        this.queue.next = await this.controller.getOne('queuelist', 'ID', 1);
        return this.queue.next;
    }

    async timeToNext() {
        let nextSong = await this.getNextSong();
        let eta;
        try{
            nextSong.ETA = moment(nextSong.ETA).local().valueOf();
            eta = nextSong.ETA - moment().local().valueOf();
        }
        catch(e){
            eta = 0;
        }
        return eta;
    }

    setController(controller) {
        this.controller = controller;
    }

}


module.exports = RdjManager;