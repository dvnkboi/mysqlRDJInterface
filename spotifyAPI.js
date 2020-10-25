const bent = require('bent');
const utils = require('./utils');
const fs = require('fs').promises;
const Model = require('./model');
var formurlencoded = require('form-urlencoded').default;
let auth = require('./auth.json');

class MBA {
    constructor(model) {

        this.auth = bent('POST',
            {
                "Content-Type": "application/x-www-form-urlencoded",
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
            maxItterations: 15,
            hardThrottle: false,
            timeout: null
        }
        this.model = model;
    }

    itterate() {
        let proxy = this;
        this.throttle.itteration++;
        this.throttle.wait = utils.map(Math.min(this.throttle.itteration, this.throttle.maxItterations), 0, this.throttle.maxItterations, 50, 250);
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
            console.log('waited', this.throttle.wait);
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
        releaseExistCheck = await this.model.getJSON('releases', 'release', res.desc, true) || [];
        if (releaseExistCheck.length >= 1) {
            console.log('release already in database');
            return null;
        }

        limit = limit ? limit : 10;
        offset = offset ? offset : 0;

        await this.checkAuth();
        this.itterate();
        await this.wait();

        let res = {};
        let desc = `${artist}_-_${title}`;

        let escapes = ['\\', '+', '-', '&&', '||', '!', '(', ')', '{', '}', '[', ']', '^', '"', '~', '*', '?', ':', '/'];
        for (const ch of escapes) {
            title = title.replace(ch, '\\' + ch);
            artist = artist.replace(ch, '\\' + ch);
        }

        let url = encodeURI(`https://musicbrainz.org/ws/2/release-group?query=artist:"${artist}" AND release:${title}&limit=${limit}&offset=${offset}`);
        res = await this.getJSON(url);
        if(res.count == 0){
            return null;
        }
        delete res.offset;
        res.desc = desc.split(' ').join('_');

        this.model.insertJSON('releases', JSON.stringify(res));

        await this.getReleaseArtists(res);
        return res;
    }

    async getReleaseArtists(releaseObj) {
        let artistExistCheck = [];
        try {
            for (const release of releaseObj['release-groups']) {
                for (const art of release['artist-credit']) {
                    if(!art.name){
                        art.name = art.artist.name;
                    }
                    artistExistCheck = await this.model.getJSON('artists', 'artist', art.name, true) || [];
                    if (artistExistCheck.length < 1) {
                        this.model.insertJSON('artists', JSON.stringify(art));
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
        for (const artist in artistRelease) {
            await this.getRelease(artist, artistRelease[artist]);
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
        let res = await this.auth('https://accounts.spotify.com/api/token', formurlencoded({ 'grant_type': 'client_credentials' }));
        res = await res.json();
        return res.access_token;
    }

    async checkAuth() {
        try {
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


(async () => {
    let title = 'FRANCHISE';
    let artist = 'travis scott';
    let store = new Model('store');
    let musicAPI = new MBA(store);
    let travis = await musicAPI.getRelease('travis scott', 'franchise');
    let artRel = {
        'travis scott': 'franchise',
        'imagine dragons': 'origins',
        'imagine dragons': 'smoke + mirrors',
        'jaden': 'erys',
        'childish gambino': 'miss anthropocene (Deluxe edition)',
        'ghostmane': 'lazaretto',
        'louis the child': 'Here For Now',
        'iamjakehill': 'Better Off Dead',
    }

    await musicAPI.getMultipleReleases(artRel);

})();




// let model = new Model('store');

// let spoopipoo = new MBA(model);


