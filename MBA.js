const bent = require('bent');
const utils = require('./utils');
const fs = require('fs').promises;
const Model = require('./model');
var formurlencoded = require('form-urlencoded').default;
let auth = require('./auth.json');

class MBA {
    constructor() {

        this.auth = bent('POST',
            {
                "Content-Type": "application/x-www-form-urlencoded",
                // eslint-disable-next-line no-undef
                "Authorization": `Basic ${Buffer.from("68c5c809200b4cdebc288db6053ad852:56f1d98cc0fb4be5ab01030136f4fded").toString('base64')}`
            }
        );

        this.headers = {
            "User-Agent": "ampuptest/0.0.1 ( ampupradio.com )",
            "Accept": "application/json"
        }
        this.getJSON = bent('GET', 'json', this.headers);
        this.getBuffer = bent('GET');
        this.throttle = {
            wait: 100,
            active: false,
            itteration: 0,
            itterationLife: 5000,
            maxItterations: 10,
            hardThrottle: false,
            timeout: null
        }
        this.model = new Model('store_-_nosql');
    }

    itterate() {
        let proxy = this;
        this.throttle.itteration++;
        this.throttle.wait = utils.map(Math.min(this.throttle.itteration, this.throttle.maxItterations), 0, this.throttle.maxItterations, 100, 1500);
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
                    await this.getRelease(art.trim(), release);
                }
            }
        }
    }

    // async downloadArtistImg(artist) {
    //     let proxy = this;
    //     let files;
    //     try {
    //         files = await fs.readdir(`./images/artists`);
    //         var img = files.find(img => {
    //             return img.includes(artist.toLowerCase());
    //         });
    //         if (!img) {
    //             throw new Error('artist image not found');
    //         }
    //     }
    //     catch (e) {
    //         //let res = await this.getArtist(artist, 1, 0);
    //         //let artistName = res.artists.items[0].name;

    //     }
    // }

    // async dlMultArtistImg(artistsToGet) {
    //     if (Array.isArray(artistsToGet) || typeof artistsToGet == 'string') {
    //         for (const artist of artistsToGet) {
    //             await this.downloadArtistImg(artist);
    //         }
    //     }
    //     else {
    //         console.error(`expected array or string ${typeof artistsToGet} provided`);
    //     }
    // }

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
            let res = await this.getJSON(encodeURI(`https://musicbrainz.org/ws/2/release-group?query=artist:"imagine dragons" AND release:origins&limit=1&offset=0`));
            return true;
        }
        catch (e) {
            console.log('authorizing');
            let token = await this.authorise();
            await this.writeAuth(token);
            this.headers.Authorization = `Bearer ${token}`;
            this.getJSON = bent('GET', 'json', this.headers);
            console.log('authorized');
            return false;
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
//     let artists = await store.getAll('artists');
//     console.log(artists.length);
//     await utils.wait(6000);
//     artists = await store.getAll('artists');
//     console.log(artists.length);
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

// })();




// let model = new Model('store');

// let spoopipoo = new MBA(model);


module.exports = MBA;