/* eslint-disable no-process-env */

const bent = require('bent');
const utils = require('./utils');
const fs = require('fs').promises;
const Model = require('./model');
var formurlencoded = require('form-urlencoded').default;
let auth = require('./auth.json');
const { EventEmitter } = require('events');
require('dotenv').config();
let defaultImg = require('./defaultImg.json');

class MBA {
    constructor() {

        this.auth = bent('POST',
            {
                "Content-Type": "application/x-www-form-urlencoded",
                // eslint-disable-next-line no-undef
                "Authorization": `Basic ${Buffer.from(process.env.PUBLIC_MB_KEY + ':' + process.env.PRIVATE_MB_KEY).toString('base64')}`
            }
        );

        this.headers = {
            "User-Agent": "ampuptest/0.0.1 ( ampupradio.com )",
            "Accept": "application/json"
        }
        this.getJSON = bent('GET', 'json', this.headers);
        this.throttle = {
            wait: 1010,
            active: false,
            itteration: 0,
            itterationLife: 5000,
            maxItterations: 20,
            hardThrottle: false,
            timeout: null,
        }
        this.retry = {
            errorBuffer:{},
            timeout:null,
            retryAfter:10000
        }
        this.model = new Model('store','nosql');
        this.events = {
            event: new EventEmitter(),
            current:0
        }
    }

    itterate() {
        let proxy = this;
        this.throttle.itteration++;
        this.throttle.wait = utils.map(Math.min(this.throttle.itteration, this.throttle.maxItterations), 0, this.throttle.maxItterations, 750, 5000);
        this.throttle.hardThrottle = this.throttle.itteration > this.throttle.maxItterations ? true : false;
        if (this.throttle.timeout != null) {
            clearTimeout(this.throttle.timeout);
            this.throttle.timeout = null;
        }

        this.throttle.timeout = setTimeout(() => {
            console.log('itteration reset');
            proxy.throttle.itteration = 0;
        }, proxy.throttle.itterationLife);


    }

    async wait() {
        if (this.throttle.active) {
            await utils.wait(this.throttle.wait);
            //console.log('waited', this.throttle.wait);
            if (!this.throttle.hardThrottle) {
                this.throttle.active = false;
            }
        }
        else {
            this.throttle.active = true;
        }
    }

    async getRelease(artist, title, limit, offset) {
        let releaseExistCheck = [];
        let res = {};
        let desc = `${artist}_-_${title}`.split(' ').join('_').toLowerCase();
        
        //console.log(desc);
        limit = limit ? limit : 10;
        offset = offset ? offset : 0;

        releaseExistCheck = await this.model.getMatching('releases', 'desc', desc, true) || [];
        if (releaseExistCheck.length >= 1) {
            //console.log('release already in database');
            return null;
        }

        await this.checkAuth();
        this.itterate();
        await this.wait();
        
        let escapes = ['\\', '+', '-', '&&', '||', '!', '(', ')', '{', '}', '[', ']', '^', '"', '~', '*', '?', ':', '/'];
        for (const ch of escapes) {
            title = title.replace(ch, '\\' + ch);
            artist = artist.replace(ch, '\\' + ch);
        }

        let url = encodeURI(`https://musicbrainz.org/ws/2/release-group?query=artist:"${artist}" AND release:${title}&limit=${limit}&offset=${offset}`);
        res = await this.getJSON(url);
        
        res.desc = desc;
        delete res.offset;

        await this.model.insert('releases', res);

        await this.getReleaseArtists(res,desc);
        return res;
    }

    async getReleaseArtists(releaseObj) {
        let artistExistCheck = [];
        try {
            if(releaseObj['release-groups'].length < 1){
                let artistName = releaseObj.desc.split("_-_")[0];
                artistExistCheck = await this.model.getMatching('artists', 'name', artistName, true);
                if (artistExistCheck.length < 1) {
                    console.log('added',artistName);
                    await this.model.insert('artists',{
                        name:artistName,
                        artist:{}
                    });
                }
                else{
                    //console.log(artistName,'already in database');
                }
            }
            for (let release of releaseObj['release-groups']) {
                for (let art of release['artist-credit']) {
                    if(!art.name){
                        //console.log('switching name');
                        art.name = art.artist.name;
                    }
                    art.name = art.name.split(' ').join('_').toLowerCase().trim();
                    artistExistCheck = await this.model.getMatching('artists', 'name', art.name, true);
                    if (artistExistCheck.length < 1) {
                        console.log('added',art.name);
                        await this.model.insert('artists',art);
                    }
                    else{
                        //console.log(art.name,'already in database');
                    }
                }
            }
            return true;
        }
        catch (e) {
            return false;
        }
    }



    async getMultipleReleases(artistRelease) {
        let artists;
        for (const artist in artistRelease) {
            for (const release of artistRelease[artist]){
                artists = artist.split(',');
                for(const art of artists){
                    if(art[0] == "_"){
                        delete art[0];
                    }
                    try{
                        await this.getRelease(art.trim(), release);
                    }
                    catch(e){
                        try{
                            this.retry.errorBuffer[art.trim()].push(release);
                            
                        }
                        catch(e){
                            this.retry.errorBuffer[art.trim()] = [];
                            this.retry.errorBuffer[art.trim()].push(release);
                        }
                    }

                    if (this.retry.timeout != null) {
                        clearTimeout(this.retry.timeout);
                        this.retry.timeout = null;
                    }

                    this.events.current++;
                    this.events.event.emit('next',{
                        current:this.events.current
                    });

                    this.retry.timeout = setTimeout(async () => {
                        console.log('retry getting failed items');
                        await this.getMultipleReleases(this.retry.errorBuffer);
                        console.log('done getting failed items');
                        this.retry.errorBuffer = {};
                    }, this.retry.retryAfter);
                }
            }
        }
        this.events.current = 0;
        this.events.event.emit('done',this.events.current);
    }

    async getReleaseGroupImgByID(releaseID,desc) {
        let url = encodeURI(`https://coverartarchive.org//release-group/${releaseID}`);
        let res;
        try {
            res = await this.getJSON(url);
            return res;
        }
        catch (redirect1) {
            if(redirect1.statusCode == 307){
                try{
                    res = await this.getJSON(redirect1.headers.location);
                    return res;
                }
                catch(redirect2){
                    if(redirect2.statusCode == 302){
                        res = await this.getJSON(redirect2.headers.location);
                        let existanceCheck = await this.model.getMatching('images','release',res.release);
                        if(existanceCheck.length < 1){
                            console.log('release image not in db');
                            res.desc = desc;
                            await this.model.insert('images',res);
                        }
                        else{
                            console.info('release',releaseID,'already in db');
                        }
                        return res;
                    }
                    else{
                        if(redirect2.statusCode == 404){
                            console.error('not found at redirect 2');
                            return false;
                        }
                        else{
                            console.error('failed at redirect 2',redirect2);
                            return false;
                        }
                    }
                }
            }
            else{
                if(redirect1.statusCode == 404){
                    console.error('not found at redirect 1');
                    // let existanceCheck = await this.model.getMatching('images','desc',desc);
                    // if(existanceCheck.length < 1){
                    //     defaultImg = JSON.parse(JSON.stringify(defaultImg));
                    //     delete defaultImg['_id'];
                    //     defaultImg.desc = desc;
                    //     await this.model.insert('images',defaultImg);
                    // }
                    // else{
                    //     console.info('release',releaseID,'already using default img');
                    // }
                    return false;
                }
                else{
                    console.error('failed at redirect 1',redirect1);
                    return false;
                }
            }
        }
    }

    async getReleaseGroupImgByDesc(releaseDesc){
        let releaseGroupObj = await this.model.getMatching('releases', 'desc', releaseDesc);
        if (releaseGroupObj.length < 1) {
            console.log('release not in Database, run updata_meta on the API');
        }
        else{
            if(releaseGroupObj.count < 1){
                //console.log('empty release group object');
            }
            else{
                for(const releaseGroup of releaseGroupObj['0']['release-groups']){
                    await this.getReleaseGroupImgByID(releaseGroup.id);
                }
            }
        }
    }

    async getAllReleaseGroupImgs(){
        let allReleaseGroupObj = await this.model.getAll('releases');
        let total = allReleaseGroupObj.length;
        if (total < 1) {
            console.log('no releases in Database, run updata_meta on the API');
        }
        else{
            for(const releaseGroupObj of allReleaseGroupObj){
                this.events.current++;
                this.events.event.emit('next',{
                    current:this.events.current,
                    total
                });
                if(releaseGroupObj.count < 1){
                    //console.log('empty release group object',releaseGroupObj.desc);
                }
                else{
                    for(const releaseGroup of releaseGroupObj['release-groups']){
                        await this.getReleaseGroupImgByID(releaseGroup.id,releaseGroupObj.desc);
                    }
                }
            }
        }
        this.events.current = 0;
        this.events.event.emit('done',{
            current:this.events.current,
            total
        });
    }

    async authorise() {
        return "null";
        // eslint-disable-next-line no-unreachable
        let res = await this.auth('https://accounts.spotify.com/api/token', formurlencoded({ 'grant_type': 'client_credentials' }));
        res = await res.json();
        return res.access_token;
    }

    async checkAuth() {
        try {
            // eslint-disable-next-line no-unused-vars
            // let res = await this.getJSON(encodeURI(`https://musicbrainz.org/ws/2/release-group?query=artist:"imagine dragons" AND release:origins&limit=1&offset=0`));
            // return true;
        }
        catch (e) {
            // console.log('authorizing');
            // let token = await this.authorise();
            // await this.writeAuth(token);
            // this.headers.Authorization = `Bearer ${token}`;
            // this.getJSON = bent('GET', 'json', this.headers);
            // console.log('authorized');
            // return false;
        }
    }

    async writeAuth(token) {
        const fileName = './auth.json';
        auth.token = token;
        await fs.writeFile(fileName, JSON.stringify(auth));
    }

}


// (async () => {
//     let store = new Model('store_-_nosql');
//     let musicAPI = new MBA(store);
//     let artRel = {
//         'travis scott': 'franchise',
//         'imagine dragons': 'origins',
//         // eslint-disable-next-line no-dupe-keys
//         'imagine dragons': 'smoke + mirrors',
//         'jaden': 'erys',
//         'childish gambino': 'miss anthropocene',
//         'ghostmane': 'lazaretto',
//         'louis the child': 'Here For Now',
//         'iamjakehill': 'Better Off Dead',
//     }
//     await musicAPI.getMultipleReleases(artRel);
//     await musicAPI.getAllReleaseGroupImgs();
// })();


module.exports = MBA;