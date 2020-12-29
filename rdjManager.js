/* eslint-disable global-require */
/* eslint-disable no-sync */
const utils = require('./utils');
const moment = require('moment-timezone');
const MBA = require('./MBA');
const Model = require('./model')
const { EventEmitter } = require("events");
const https = require('https');
var app = require('express')();
const fs = require('fs');

class RdjManager {

    constructor(controller) {
        this.controller = controller;
        this.songPreload = null;
        this.metaStore = new Model('store', 'nosql');
        this.watchers;
        this.API = {
            mba: new MBA(),
            buffer: {},
            timeout: null,
            flushAfter: 5000,
            rowsToFlush: 0,
            busy: false,
            retries: 5,
            retriesRemaining: 5,
            status: 'initialized',
            retryTimeout: null,
            action: 'none',
            current: 0,
            total: 0
        };
        this.API.event = this.API.mba.events.event;
        this.API.event.on('next', (res) => {
            this.API.current = res.current;
            this.API.total = res.total;
        });
        RdjManager.queue = {
            event: new EventEmitter(),
            next: null,
            current: null,
            previous: null,
            history: null,
            timeToNext: -1
        }
        this.history = [];
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
        //await this.initSongEvents();
    }

    async processRequest(config) {
        let result = {
            response: []
        };

        result.caller = await this.controller.manageBlackList(config.apiKey);

        let processTime = Date.now();
        result.reqDate = new Date().toJSON();

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
            result = await this.handleGetReq(result, config);
        }
        else if (config.action == 'update_meta') {
            result.response = await this.updateMeta();
        }
        else if (config.action == 'update_artwork') {
            result.response = await this.updateArtwork();
        }
        else if (config.action == 'get_status') {
            result.response = await this.getStatus();
        }
        else if (config.action == 'get_queue') {
            result.response = JSON.parse(JSON.stringify(RdjManager.queue));
            delete result.response.event;
        }
        else if (config.action == 'get_timeToNext') {
            result.response = await this.timeToNext();
        }
        else if (config.action == 'get_art') {
            result.response = RdjManager.currentArt;
            delete result.response.event;
        }
        else if(config.action == 'get_next_art'){
            result.response = RdjManager.nextArt;
            delete result.response.event;
        }
        else {
            this.controller.sendError(400, 'invalid action');
            return;
        }

        result = await this.handleArrayResponse(result, config);

        result.timeTaken = Date.now() - processTime + 'ms';

        if (!this.controller.res.headersSent) {
            this.controller.res.json(result);
        }
    }

    async getArt(){
        console.log('getting art');
        if(!RdjManager.currentArt){
            RdjManager.currentArt = [];
        }
        RdjManager.nextArt = await this.metaStore.getMatching('images', 'desc', (RdjManager.queue.next.artist.trim().split(',')[0].split(' ').join('_') + '_-_' + RdjManager.queue.next.album.trim().split(' ').join('_')).toLowerCase(), true);
        
        for(var i = 0; i < RdjManager.queue.history.length; i++){
            RdjManager.currentArt[i] = await this.metaStore.getMatching('images', 'desc', (RdjManager.queue.history[i].artist.trim().split(',')[0].split(' ').join('_') + '_-_' + RdjManager.queue.history[i].album.trim().split(' ').join('_')).toLowerCase(), true);
        }
    }

    async handleArrayResponse(result, config) {
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
        return result;
    }

    async handleGetReq(result, config) {
        let element = [];
        let proxy = this;
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
        return result;
    }

    async getHistory(limit) {
        let tmpLimit = this.controller.model.limit;
        let tmpoffset = this.controller.model.offset;
        let tmpSortRef = this.controller.model.sortRef;
        let tmpSortDir = this.controller.model.sortDir;

        this.controller.model.limit = limit ? limit : 10;
        this.controller.model.offset = 0;
        this.controller.model.sortRef = 'ID';
        this.controller.model.sortDir = 'desc';

        RdjManager.queue.history = await this.controller.model.getAll('history');

        RdjManager.queue.current = RdjManager.queue.history[0];
        RdjManager.queue.previous = RdjManager.queue.history[1];

        await this.getArt();
        console.log('got art');

        this.controller.model.limit = tmpLimit;
        this.controller.model.offset = tmpoffset;
        this.controller.model.sortRef = tmpSortRef;
        this.controller.model.sortDir = tmpSortDir;
    }

    async emitPreloadEvents(eta) {

        if (this.songPreload != null) {
            clearTimeout(this.songPreload);
            this.songPreload = null;
        }

        let changeCheck;
        changeCheck = JSON.stringify(RdjManager.queue.next);

        if (eta - 5000 > 0) {
            if (eta - 10000 > 0) {
                if (eta - 25000 > 0) {
                    this.songPreload = setTimeout(async () => {
                        await this.getNextSong();
                        if (changeCheck != JSON.stringify(RdjManager.queue.next)) {
                            //console.log('preload changed',RdjManager.queue.next.title);
                        }
                        changeCheck = JSON.stringify(RdjManager.queue.next);
                        RdjManager.queue.event.emit('safePreload', RdjManager.queue.next);
                    }, eta - 25000);
                }
                this.songPreload = setTimeout(async () => {
                    await this.getNextSong();
                    if (changeCheck != JSON.stringify(RdjManager.queue.next)) {
                        console.log('preload changed yikes', RdjManager.queue.next.title);
                    }
                    changeCheck = JSON.stringify(RdjManager.queue.next);
                    RdjManager.queue.event.emit('preload', RdjManager.queue.next);
                }, eta - 10000);
            }
            this.songPreload = setTimeout(async () => {
                await this.getNextSong();
                if (changeCheck != JSON.stringify(RdjManager.queue.next)) {
                    console.log('unsafe preload change stop that lol', RdjManager.queue.next.title);
                }
                changeCheck = JSON.stringify(RdjManager.queue.next);
                RdjManager.queue.event.emit('unsafePreload', RdjManager.queue.next);
            }, eta - 5000);
        }
    }

    async watchHistory() {
        await this.controller.watch('radiodj2020.history.*');
        let eta = await this.timeToNext();
        await this.getHistory();
        if (eta > 0) {
            console.log(utils.formatedTime(eta / 1000), 'to next song');
        }

        if (this.songPreload != null) {
            clearTimeout(this.songPreload);
            this.songPreload = null;
        }

        await this.emitPreloadEvents(eta);

        return this.controller.eventHandler.on('history', async () => {
            eta = await this.timeToNext();
            await this.getHistory();
            RdjManager.queue.event.emit('songChanged', RdjManager.queue);
            await this.emitPreloadEvents(eta);

        });

    }

    async initSongEvents() {
        RdjManager.queue.event.on('preload', (next) => {
            console.log('preload', next.title);
            RdjManager.sendJson({ state: 'preload' });
        });
        RdjManager.queue.event.on('safePreload', (next) => {
            console.log('safe preload', next.title);
        });

        RdjManager.queue.event.on('unsafePreload', (next) => {
            console.log('unsafe preload', next.title);
        });

        RdjManager.queue.event.on('songChanged', async () => {
            let current, next, previous;
            try {
                next = RdjManager.queue.next.title;
                previous = RdjManager.queue.previous.title;
                current = RdjManager.queue.current.title;
                console.log('songChanged', {
                    next,
                    current,
                    previous
                });

            }
            catch (e) {
                await this.timeToNext();

                try {
                    next = RdjManager.queue.next.title;
                }
                catch (e) {
                    next = null;
                }
                try {
                    current = RdjManager.queue.current.title;
                }
                catch (e) {
                    current = null;
                }
                try {
                    previous = RdjManager.queue.previous.title;
                }
                catch (e) {
                    previous = null;
                }
                console.log('songChanged', 'OTF update', {
                    next,
                    current,
                    previous
                });
            }
        });
    }

    async watchSongs() {
        let proxy = this;
        await this.controller.watch(`radiodj2020.songs.*`);
        this.controller.eventHandler.on('songs', async (event) => {
            if (event.type == 'INSERT') {
                console.log('song added ', `${event.affectedRows[0].after.artist} - ${event.affectedRows[0].after.title} (${event.affectedRows[0].after.album})`);
                try {
                    proxy.API.buffer[event.affectedRows[0].after.artist].push(event.affectedRows[0].after.album);
                    proxy.API.rowsToFlush++;
                }
                catch (e) {
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

    async flushBufferToMeta() {
        if (this.API.busy) {
            if (this.API.retriesRemaining > 0 && this.API.status != "server busy") {
                this.API.retriesRemaining--;
                this.API.status = 'retrying';
                console.log('retrying');
                this.API.retryTimeout = setTimeout(async () => this.flushBufferToMeta(), 5000);
            }
            else {
                if (this.API.retryTimeout != null) {
                    clearTimeout(this.API.retryTimeout);
                    this.API.retryTimeout = null;
                }
                this.API.status = 'server busy';
                console.log('server busy try again later');
            }
        }
        else {
            this.API.busy = true;
            console.log('flushing ', this.API.rowsToFlush);
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
            }, 5000);
            console.log('job done');
        }
    }

    async updateMeta() {
        this.API.action = 'update metadata';
        this.API.status = 'started';
        if (!this.controller.res.headersSent) {
            this.controller.res.json({
                action: this.API.action,
                songsProcessed: 'all',
                status: this.API.status
            });
        }
        let songs = await this.controller.getAll('songs');
        this.API.buffer = {};
        let proxy = this;
        for (const song of songs) {
            //console.log('song added ', `${song.artist} - ${song.title} (${song.album})`);
            try {
                proxy.API.buffer[song.artist].push(song.album);

            }
            catch (e) {
                proxy.API.buffer[song.artist] = [];
                proxy.API.buffer[song.artist.trim()].push(song.album);
            }
        }
        await this.flushBufferToMeta();
        return {
            action: this.API.action,
            songsProcessed: songs.length,
            status: this.API.status
        };
    }

    async updateArtwork() {
        let res;
        this.API.action = 'update artwork';
        this.API.status = 'started';
        if (this.API.busy) {
            if (this.API.retriesRemaining > 5 && this.API.status != "server busy") {
                this.API.retriesRemaining--;
                this.API.status = 'retrying';
                console.log('retrying');
                this.API.retryTimeout = setTimeout(async () => this.updateArtwork(), 5000);
            }
            else {
                if (this.API.retryTimeout != null) {
                    clearTimeout(this.API.retryTimeout);
                    this.API.retryTimeout = null;
                }
                this.API.status = 'server busy';
                console.log('server busy try again later');
                return {
                    action: this.API.action,
                    songsProcessed: res,
                    status: 'server busy'
                };
            }
        }
        else {
            this.API.busy = true;
            if (!this.controller.res.headersSent) {
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
            }, 5000);
            console.log('job done');
        }
        return {
            action: this.API.action,
            songsProcessed: res,
            status: 'job done'
        };
    }

    async getStatus() {
        return {
            action: this.API.action,
            status: this.API.status,
            current: this.API.current,
            total: this.API.total
        };
    }

    async getNextSong() {
        RdjManager.queue.next = await this.controller.getOne('queuelist', 'ID', 1);
        return RdjManager.queue.next;
    }

    async timeToNext() {
        let nextSong = await this.getNextSong();
        let eta;
        try {
            nextSong.ETA = moment(nextSong.ETA).local().valueOf();
            eta = nextSong.ETA - moment().local().valueOf();
        }
        catch (e) {
            eta = 0;
        }
        RdjManager.queue.timeToNext = eta;
        try {
            RdjManager.queue.next.ETA = eta;
        }
        catch (e) {
            RdjManager.queue.next = null;
        }
        return eta;
    }

    setController(controller) {
        this.controller = controller;
    }

}

try {
    let clients = {};
    RdjManager.sockets= [];
    let options = {
        key: fs.readFileSync('C:/Certbot/archive/api.ampupradio.com/privkey1.pem', 'utf8'),
        cert: fs.readFileSync('C:/Certbot/archive/api.ampupradio.com/cert1.pem', 'utf8'),
        ca: fs.readFileSync('C:/Certbot/archive/api.ampupradio.com/chain1.pem', 'utf8')
    };
    // eslint-disable-next-line new-cap
    let server = https.createServer(options, app);
    server.listen(8080);
    // eslint-disable-next-line global-require
    const io = require('socket.io')(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        }
    });
    app.get('/', function (req, res) {
        res.send('server is running');
    });
    console.log('socket listenning');
    io.sockets.on('connection', (socket) => {


        // either with send()
        socket.send('hello from server : D ' + socket.id);
        RdjManager.queue.event.removeAllListeners();
        RdjManager.queue.event.on('preload',() => {
            io.sockets.emit('preload');
        });
        RdjManager.queue.event.on('safePreload',() => {
            io.sockets.emit('safePreload');
        });
        RdjManager.queue.event.on('unsafePreload',() => {
            io.sockets.emit('unsafePreload');
        });
        RdjManager.queue.event.on('songChanged',() => {
            io.sockets.emit('songChanged');
        });

        // handle the event sent with socket.send()
    });

    
}
catch (e) {
    console.log(e);
}

module.exports = RdjManager;