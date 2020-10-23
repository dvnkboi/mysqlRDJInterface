var mysql = require('mysql');
const BaseDatabase = require("mysql-async-wrapper").default;
const utils = require('./utils');
const MySQLEvents = require('@rodrigogs/mysql-events');
const { EventEmitter } = require("events");


class Model {

    constructor(db) {

        //main api model const
        this.config = { // connection to db with config
            host: 'localhost',
            user: 'root',
            password: '8576',
            database: db,
            connectionLimit: 10,
            waitForConnections: true,
            queueLimit: 0
        };
        this.life = {
            stayConnected: false,
            ttl: 5000,
            timeout: null,
            watcherCount:0,
            isConnected:false
        }
        try {
            this.pool = mysql.createPool(this.config);
            this.db;
            this.connection;
        }
        catch (err) {
            console.error('error creating model with given config');
        }
        this.limit;
        this.offset = 0;
        this.sortRef;
        this.sortDir = 'asc';
        this.eventHandler = {
            timeout: 10,
            allow: true,
            throttle: true,
            event: new EventEmitter()
        };
    }

    manageLife(){
        let proxy = this;
        if (this.life.timeout != null) {
            clearTimeout(this.life.timeout);
            this.life.timeout = null;
        }
        if(this.life.watcherCount < 1){
            this.life.timeout = setTimeout(() => {
                if(this.life.isConnected){
                    proxy.disconnect();
                    proxy.eventHandler.event.emit('died');
                    this.life.isConnected = false;
                }
            }, proxy.life.ttl);
        }
    }

    async connect() {
        const maxRetryCount = 3; // Number of Times To Retry
        const retryErrorCodes = ["ER_LOCK_DEADLOCK", "ERR_LOCK_WAIT_TIMEOUT"] // Retry On which Error Codes 
        try {
            this.db = new BaseDatabase(this.pool, { //wrap mysql pool in async/await compatible class
                maxRetryCount,
                retryErrorCodes
            });
            this.connection = await this.db.getConnection();
            console.info('connected to ' + this.config.database);

            return true;
        }
        catch (err) {
            console.error(err);
            return false;
        }
    }

    async watch(schema) {
        this.life.watcherCount++;
        let proxy = this;
        this.watcher = new MySQLEvents(this.pool, {
            startAtEnd: true,
            excludedSchemas: {
                mysql: true,
            },
        });
        await this.watcher.start();
        
        try {
            console.log('watcher started on ' + schema.split('.')[1]);
        }
        catch (e) {
            console.log('watcher started on ' + schema);
        }

        this.watcher.addTrigger({
            name: schema,
            expression: schema,
            statement: MySQLEvents.STATEMENTS.ALL,
            onEvent: async (event) => {
                if (proxy.eventHandler.throttle) {
                    if (proxy.eventHandler.allow) {
                        proxy.eventHandler.allow = false;

                        proxy.eventHandler.event.emit(event.table, event);

                        setTimeout(() => {
                            proxy.eventHandler.allow = true;
                        }, proxy.eventHandler.timeout);
                    }
                }
                else {
                    proxy.eventHandler.allow = true;
                    proxy.eventHandler.event.emit(event.table, event);
                }
            },
        });
    }

    async unwatch(schema) {
        this.life.watcherCount--;
        await this.watcher.removeTrigger({
            name: schema,
            expression: schema,
            statement: MySQLEvents.STATEMENTS.ALL,
        });
    }

    async getMatching(table, col, ref, strict) { //get all items matching col == ref or col like %ref%
        this.manageLife();
        
        let query;
        
        //pagination and sort
        let queryLimit;
        let querySort;
        if (this.limit) {
            queryLimit = `LIMIT ${this.limit} OFFSET ${this.offset} `;
        }
        else {
            queryLimit = ``;
        }
        if (this.sortRef) {
            if (this.sortDir == 'asc') {
                querySort = `ORDER BY ${this.sortRef} ASC `;
            }
            else if (this.sortDir == 'desc') {
                querySort = `ORDER BY ${this.sortRef} DESC `;
            }
        }
        else {
            querySort = ``;
        }


        if (utils.isInt(ref)) {
            ref = parseInt(ref);
            query = `Select * from ${table} where ${col} = ${ref} `;
        }
        else {
            if (strict == 'true') {
                query = `Select * from ${table} where ${col} = "${ref}" `;
            }
            else {
                query = `Select * from ${table} where ${col} like '%${ref}%' `;
            }
        }

        query += querySort + queryLimit;
        try {
            if (!this.life.isConnected) {
                this.life.isConnected = true;
                await this.connect();
            }
            const res = await this.connection.executeQuery(query, []);
            return res;
        }
        catch (err) {
            console.error(err);
            return null;
        }
        finally {
            //this.disconnect(); // To Release Connection
            //console.log('disconnected');
        }
    }

    async getAll(table) {
        this.manageLife();
        //pagination and sort
        let queryLimit;
        let querySort;
        if (this.limit) {
            queryLimit = `LIMIT ${this.limit} OFFSET ${this.offset} `;
        }
        else {
            queryLimit = ``;
        }
        if (this.sortRef) {
            if (this.sortDir == 'asc') {
                querySort = `ORDER BY ${this.sortRef} ASC `;
            }
            else if (this.sortDir == 'desc') {
                querySort = `ORDER BY ${this.sortRef} DESC `;
            }
        }
        else {
            querySort = ``;
        }

        let query = `Select * from ${table} ` + querySort + queryLimit;

        try {
            if (!this.life.isConnected) {
                this.life.isConnected = true;
                await this.connect();
            }
            const res = await this.connection.executeQuery(query, []);

            return res;
        }
        catch (err) {
            console.error(err);
            return null;
        }
        finally {
            //this.disconnect(); // To Release Connection
            //console.log('disconnected');
        }
    }

    async getAllJSON(table) {
        this.manageLife();
        //pagination and sort
        let queryLimit;
        let querySort;
        if (this.limit) {
            queryLimit = `LIMIT ${this.limit} OFFSET ${this.offset} `;
        }
        else {
            queryLimit = ``;
        }
        if (this.sortRef) {
            if (this.sortDir == 'asc') {
                querySort = `ORDER BY ${this.sortRef} ASC `;
            }
            else if (this.sortDir == 'desc') {
                querySort = `ORDER BY ${this.sortRef} DESC `;
            }
        }
        else {
            querySort = ``;
        }

        let query = `Select * from ${table} ` + querySort + queryLimit;

        try {
            if (!this.life.isConnected) {
                this.life.isConnected = true;
                await this.connect();
            }
            const res = await this.connection.executeQuery(query, []);
                for (var i = 0; i < res.length; i++) {
                    res[i] = JSON.stringify(res[i]);
                    res[i] = JSON.parse(res[i]);
                    Object.keys(res[i]).forEach(function (key) {
                        res[i][key] = JSON.parse(res[i][key]);
                    });
                }
            return res;
        }
        catch (err) {
            return null;
        }
        finally {
            //this.disconnect(); // To Release Connection
            //console.log('disconnected');
        }
    }

    async getTables() {
        this.manageLife();
        let query = `SELECT table_name as 'table' FROM information_schema.tables WHERE table_schema = "${this.config.database}"`;

        try {
            if (!this.life.isConnected) {
                this.life.isConnected = true;
                await this.connect();
            }
            const res = await this.connection.executeQuery(query, []);
            return res;
        }
        catch (err) {
            return null;
        }
        finally {
            //this.disconnect(); // To Release Connection
            //console.log('disconnected');
        }
    }

    async getNumOfRows(table) {
        this.manageLife();

        let query = `Select count(*) as "count" from ${table}`;

        try {
            if (!this.life.isConnected) {
                this.life.isConnected = true;
                await this.connect();
            }
            const res = await this.connection.executeQuery(query, []);
            return res[0].count;
        }
        catch (err) {
            return 0;
        }
        finally {
            //this.disconnect(); // To Release Connection
            //console.log('disconnected');
        }
    }

    setThrottle(throttle) {
        if (typeof t == 'boolean') {
            this.eventHandler.throttle = throttle;
        }
    }

    setThrottleTimeout(timeout) {
        if (typeof t == 'number') {
            this.eventHandler.timeout = timeout;
        }
    }

    async getJSON(table, col, ref, strict) {
        this.manageLife();
        let query;

        //pagination and sort
        let queryLimit;
        let querySort;
        if (this.limit) {
            queryLimit = `LIMIT ${this.limit} OFFSET ${this.offset} `;
        }
        else {
            queryLimit = ``;
        }
        if (this.sortRef) {
            if (this.sortDir == 'asc') {
                querySort = `ORDER BY ${table}->>"$.${this.sortRef}" ASC `;
            }
            else if (this.sortDir == 'desc') {
                querySort = `ORDER BY ${table}->>"$.${this.sortRef}" DESC `;
            }
        }
        else {
            querySort = ``;
        }

        if (utils.isInt(ref)) {
            ref = parseInt(ref);
            query = `Select * from ${table} where artist->>"$.${col}" = ${ref} `;
        }
        else {
            if (strict == 'true') {
                query = `Select * from ${table} where artist->>"$.${col}" = "${ref}" `;
            }
            else {
                query = `Select * from ${table} where artist->>"$.${col}" like '%${ref}%' `;
            }
        }

        query += querySort + queryLimit;
        try {
            if (!this.life.isConnected) {
                this.life.isConnected = true;
                await this.connect();
            }
            let res = await this.connection.executeQuery(query, []);
            for (var i = 0; i < res.length; i++) {
                res[i] = JSON.stringify(res[i]);
                res[i] = JSON.parse(res[i]);
                Object.keys(res[i]).forEach(function (key) {
                    res[i][key] = JSON.parse(res[i][key]);
                });
            }
            return res;
        }
        catch (err) {
            return null;
        }
        finally {
            //this.disconnect(); // To Release Connection
            //console.log('disconnected');
        }
    }

    async insertJSON(table,object){
        this.manageLife();
        let query;
        query = `insert into ${table} values('${object}')`;
        try {
            if (!this.life.isConnected) {
                this.life.isConnected = true;
                await this.connect();
            }
            let res = await this.connection.executeQuery(query, []);
            return res;
        }
        catch (err) {
            console.log(err);
            return null;
        }
        finally {
            //this.disconnect(); // To Release Connection
            //console.log('disconnected');
        }
    }

    disconnect(){
        try{
            console.info('disconnected from ',this.config.database);
            this.db.close();
        }
        catch(e){
            
        }
    }

};

module.exports = Model;

