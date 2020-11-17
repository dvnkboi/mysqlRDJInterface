var mysql = require('mysql');
const BaseDatabase = require("mysql-async-wrapper").default;
const utils = require('./utils');
const MySQLEvents = require('@rodrigogs/mysql-events');
const { EventEmitter } = require("events");
const MongoClient = require('mongodb').MongoClient;


class Model {

    constructor(db) {
        this.dbName = db.split('_-_')[0];
        this.dbType = db.split('_-_')[1];
        if (this.dbType == "sql") {
            //mysql config const
            this.config = { // connection to db with config
                host: 'localhost',
                user: 'root',
                password: '8576',
                database: this.dbName,
                connectionLimit: 10,
                waitForConnections: true,
                queueLimit: 0
            };
            try {
                this.pool = mysql.createPool(this.config);
                this.db;
                this.connection;
            }
            catch (err) {
                console.error('error creating model with given config');
            }
        }
        else if (this.dbType == "nosql") {
            this.connectionString = `mongodb://admin:List2kat@localhost:27017/?authSource=admin&replicaSet=rsMain`;
            this.connectionParams = {
                useNewUrlParser: true,
                useUnifiedTopology: true
            };
            this.connection;
            this.client = null;
            this.collections = {};
        }
        this.watcher = {};


        //manage TTL of connection, is connection does not query for more than ttl, it disconnects 
        this.life = {
            keepAlive: false,
            ttl: 5000,
            timeout: null,
            watcherCount: 0,
            isConnected: false
        }
        this.limit;
        this.offset = 0;
        this.sortRef;
        this.sortDir = 'asc';
        this.eventHandler = {
            timeout: 0,
            allow: true,
            throttle: true,
            event: new EventEmitter(),
            hasDied: false
        };
    }

    async manageLife() {
        let proxy = this;
        if (this.life.timeout != null) {
            clearTimeout(this.life.timeout);
            this.life.timeout = null;
        }
        if (this.life.watcherCount < 1) {
            this.life.timeout = setTimeout(async () => {
                if (this.life.isConnected) {
                    await proxy.disconnect();
                }
            }, proxy.life.ttl);
        }
    }

    async connect() {
        try {
            if (!this.life.isConnected) {
                this.life.isConnected = true;
                if (this.dbType == "sql") {
                    const maxRetryCount = 3; // Number of Times To Retry
                    const retryErrorCodes = ["ER_LOCK_DEADLOCK", "ERR_LOCK_WAIT_TIMEOUT"] // Retry On which Error Codes 
                    try {
                        this.db = new BaseDatabase(this.pool, { //wrap mysql pool in async/await compatible class
                            maxRetryCount,
                            retryErrorCodes
                        });
                        this.connection = await this.db.getConnection();
                        console.info('connected to ' + this.dbName + ' SQL');

                        return true;
                    }
                    catch (e) {
                        console.error(e);
                        return false;
                    }
                }
                else if (this.dbType == "nosql") {
                    try {
                        this.client = await MongoClient.connect(this.connectionString, this.connectionParams);
                        this.connection = this.client.db(`${this.dbName}`);
                        console.info('connected to ' + this.dbName + ' NOSQL');
                    }
                    catch (e) {
                        console.error(e);
                        return false;
                    }
                }
            }
        }
        catch (e) {
            console.log(e);
        }
    }

    async watch(schema) {
        await this.connect();
        this.life.watcherCount++;
        let proxy = this;
        if (this.dbType == 'sql') {
            if (Object.keys(this.watcher).length === 0 && this.watcher.constructor === Object) {
                this.watcher = new MySQLEvents(this.pool, {
                    startAtEnd: true,
                    excludedSchemas: {
                        mysql: true,
                    },
                });
                try {
                    await this.watcher.start();
                }
                catch (e) {
                    console.error(e);
                }
            }
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
                    }
                },
            });
        }
        else if (this.dbType == 'nosql') {
            try {
                if (!schema.split('.')[1]) {
                    throw new Error('pass');
                }
                else {
                    console.log('expected collection,mysql schema given', schema);
                }
            }
            catch (e) {
                await this.manageCollections(schema);
                this.watcher[schema] = await this.collections[schema].watch();
                console.log('watching', schema);
                this.watcher[schema].on("change", (next) => {
                    if (proxy.eventHandler.throttle) {
                        if (proxy.eventHandler.allow) {
                            proxy.eventHandler.allow = false;
                            console.log(next);
                            proxy.eventHandler.event.emit(schema, next);
                            setTimeout(() => {
                                proxy.eventHandler.allow = true;
                            }, proxy.eventHandler.timeout);
                        }
                    }
                    else {
                        proxy.eventHandler.allow = true;
                    }
                });
            }
        }
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
        await this.manageLife();
        await this.connect();

        if (this.dbType == 'sql') {
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
        else if (this.dbType == 'nosql') {
            let filter = {};
            if (strict) {
                filter[col] = ref;
            }
            else {
                filter[col] = { $regex: `.*${ref}.*` };
            }
            try {

                await this.manageCollections(table);
                let res = await this.collections[table].find(filter).skip(this.offset);
                if (this.limit) {
                    res = await res.limit(this.limit);
                }
                if (this.sortRef) {
                    let sort = {};
                    sort[this.sortRef] = this.sortDir == "desc" ? -1 : 1;
                    res = await res.sort(sort);
                }
                res = await res.toArray();
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
    }

    async getAll(table) {
        await this.manageLife();
        await this.connect();

        //pagination and sort
        let queryLimit;
        let querySort;

        if (this.dbType == 'sql') {
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
        else if (this.dbType == 'nosql') {

            try {
                await this.manageCollections(table);
                let res = await this.collections[table].find().skip(this.offset);
                if (this.limit) {
                    res = await res.limit(this.limit);
                }
                if (this.sortRef) {
                    let sort = {};
                    sort[this.sortRef] = this.sortDir == "desc" ? -1 : 1;
                    res = await res.sort(sort);
                }
                res = await res.toArray();
                return res;
            }
            catch (err) {
                console.error('error in get all nosql');
                return null;
            }
            finally {
                //this.disconnect(); // To Release Connection
                //console.log('disconnected');
            }
        }

    }

    async getTables() {
        await this.manageLife();
        await this.connect();

        if (this.dbType == 'sql') {
            let query = `SELECT table_name as 'table' FROM information_schema.tables WHERE table_schema = "${this.config.database}"`;

            try {
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
        if (this.dbType == 'nosql') {
            try {
                const res = await this.connection.listCollections({}, { nameOnly: true }).toArray();
                return res;
            }
            catch (e) {
                return null;
            }
            finally {
                //this.disconnect();
            }
        }
    }

    async getNumOfRows(table) {
        await this.manageLife();
        await this.connect();

        if (this.dbType == 'sql') {
            let query = `Select count(*) as "count" from ${table}`;

            try {
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
        else if (this.dbType == 'nosql') {
            try {
                await this.manageCollections(table);
                const res = await this.collections[table].estimatedDocumentCount();
                return res;
            }
            catch (err) {
                console.log('error getting number of rows for nosql', table);
                return 0;
            }
            finally {
                //this.disconnect(); // To Release Connection
                //console.log('disconnected');
            }
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

    async insert(table, object) {
        await this.manageLife();
        await this.connect();

        if (this.dbType == 'sql') {
            //code to sequalize object and turn it into valid query 
            try {
                return true;
            }
            // eslint-disable-next-line no-unreachable
            catch (err) {
                console.log(err);
                return false;
            }
            finally {
                //this.disconnect(); // To Release Connection
                //console.log('disconnected');
            }
        }
        else if (this.dbType == 'nosql') {
            try {
                await this.manageCollections(table);
                await this.collections[table].insertOne(object);
                return true;
            }
            catch (err) {
                console.log(err);
                return false;
            }
            finally {
                //this.disconnect(); // To Release Connection
                //console.log('disconnected');
            }
        }

    }

    async remove(table, col, ref, one) {
        await this.manageLife();
        await this.connect();

        let filter = {};
        filter[col] = ref;
        one = one ? true : false;
        if (this.dbType == 'sql') {
            //code to remove item from db
            try {
                return true;
            }
            // eslint-disable-next-line no-unreachable
            catch (err) {
                console.log(err);
                return false;
            }
            finally {
                //this.disconnect(); // To Release Connection
                //console.log('disconnected');
            }
        }
        else {
            try {
                await this.manageCollections(table);

                if (one) {
                    let res = await this.collections[table].deleteOne(filter);
                    return res;
                }
                else {
                    let res = await this.collections[table].deleteMany(filter);
                    return res;
                }
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
    }

    async manageCollections(table) {
        try {
            if (!this.collections[table]) {
                this.collections[table] = await this.connection.collection(table);
            }
            return true;
        }
        catch (e) {
            console.error('error managing collection', table);
            return false
        }
    }

    async disconnect() {
        this.life.isConnected = false;
        if (this.dbType == 'sql') {
            try {
                console.info('disconnected from ', this.dbName);
                this.db.close();
                this.eventHandler.hasDied = true;
                this.eventHandler.event.emit('died');
            }
            catch (e) {
                console.log('could not disconnect');
            }
        }
        else if (this.dbType == 'nosql') {
            try {
                console.info('disconnected from ', this.dbName);
                await this.client.close();
                this.connection;
                this.client = null;
                this.collections = {};
                this.eventHandler.hasDied = true;
                this.eventHandler.event.emit('died');
            }
            catch (e) {
                console.log('could not disconnect');
            }
        }
    }

    setDb(dbName, dbType) {
        this.life.isConnected = false;
        this.dbName = dbName;
        this.dbType = dbType;
        if (this.dbType == 'sql') {
            //mysql config const
            this.config = { // connection to db with config
                host: 'localhost',
                user: 'root',
                password: '8576',
                database: this.dbName,
                connectionLimit: 10,
                waitForConnections: true,
                queueLimit: 0
            };
            try {
                this.pool = mysql.createPool(this.config);
                this.db = null;
                this.connection = null;
            }
            catch (err) {
                console.error('error creating model with given config');
            }
        }
        else if (this.dbType == 'nosql') {
            this.connectionString = `mongodb://admin:List2kat@localhost:27017/?authSource=admin&replicaSet=rsMain`;
            this.connectionParams = {
                useNewUrlParser: true,
                useUnifiedTopology: true
            };
            this.connection = null;
            this.client = null;
            this.collections = {};
        }
    }

}


module.exports = Model;

