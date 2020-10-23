const bent = require('bent');
const utils = require('./utils');
const fs = require('fs').promises;
const Model = require('./model');
var formurlencoded = require('form-urlencoded').default;


class spotifyAPI {
    constructor(model) {

        this.auth = bent('POST',
            {
                "Content-Type": "application/x-www-form-urlencoded",
                "Authorization": `Basic ${Buffer.from("68c5c809200b4cdebc288db6053ad852:56f1d98cc0fb4be5ab01030136f4fded").toString('base64')}`
            }
        );

        this.headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            Authorization: "Bearer BQClAmjuxNrJZ0VHxMm6Lh-LIZIXIXKodQB26hD63p8lCt9vQSLAnObycxLy7GcVyu0kxUhuxIYZEh2Syvg_tPyEyXuuFqe0qQ51ig1Ub_UDKODkrySaifAAQ5rBOeC6hh_lNtkzJE4M79oMoZ9MmheiwPwm0ok"
        };
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

    async authorise() {
        let res = await this.auth('https://accounts.spotify.com/api/token',formurlencoded({'grant_type': 'client_credentials'}));
        res = await res.json();
        return res.access_token;
    }

    itterate() {
        let proxy = this;
        this.throttle.itteration++;
        this.throttle.wait = utils.map(Math.min(this.throttle.itteration, this.throttle.maxItterations), 0, this.throttle.maxItterations, 100, 250);
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

    async getArtist(artist, limit, offset) {
        await this.checkAuth();
        this.itterate();
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

        artist = encodeURIComponent(artist);
        offset = offset ? offset : 0;
        limit = limit ? limit : 10;
        try {
            let res = await this.getJSON(`https://api.spotify.com/v1/search?q=${artist}&type=artist&offset=${offset}&limit=${limit}`);

            let dbArtist = await this.model.getJSON('artists', 'name', res.artists.items[0].name, false);
            if (dbArtist.length < 1) {
                let modRes = JSON.parse(JSON.stringify(res));
                modRes = modRes.artists.items[0];
                this.model.insertJSON('artists', JSON.stringify(modRes));
            }
            return res;
        }
        catch (e) {
            console.error(e);
            return null;
        }
    }

    async checkAuth() {
        try {
            let res = await this.getJSON(`https://api.spotify.com/v1/search?q=imagine&type=artist&offset=0&limit=1`);
            return true;
        }
        catch (e) {
            console.log('authorizing');
            let token = await this.authorise();
            this.headers.Authorization = `Bearer ${token}`;
            this.getJSON = bent('GET', 'json', this.headers);
            console.log('authorized');
            return false;
        }
    }

    async downloadArtistImg(artist) {
        let proxy = this;
        let files;
        try {
            files = await fs.readdir(`./images/artists`);
            var img = files.find(img => {
                console.log(img,artist.toLowerCase());
                return img.includes(artist.toLowerCase());
            });
            if(!img){
                throw new Error('artist image not found');
            }
        } 
        catch (e) {
            let res = await this.getArtist(artist, 1, 0);
            let artistName = res.artists.items[0].name;
            if (res) {
                for (const img of res.artists.items[0].images) {
                    try {
                        await fs.access(`./images/artists/${artistName.toLowerCase()}_-_${img.height}_-_${img.width}`);
                    }
                    catch(e){
                        let image = await proxy.getBuffer(img.url);
                        image = await image.arrayBuffer();
                        if (image) {
                            await fs.writeFile(`./images/artists/${artistName.toLowerCase()}_-_${img.height}_-_${img.width}`, image);
                            console.log('got images for ',artistName.toLowerCase());
                        }
                        else {
                            console.log('couldnt process image');
                        }
                    }
                }
            }
        }
    }

    async dlMultArtistImg(artistsToGet) {
        if (Array.isArray(artistsToGet) || typeof artistsToGet == 'string') {
            for (const artist of artistsToGet) {
                await spoopipoo.downloadArtistImg(artist);
            }
        }
        else {
            console.error(`expected array or string ${typeof artistsToGet} provided`);
        }
    }

}


let model = new Model('store');

let spoopipoo = new spotifyAPI(model);

(async () => {
    artistsToGet = [
        'imagine dragons',
        'FRND',
        'gwen stefani',
        'party favor',
        'ghostmane',
        'skrillex',
        'diplo',
        'Grimes',
        'troyboi',
        'dillon francis',
        'caravan palace',
        'Panic!At the disco',
        'Bon iver',
        'joji',
        'bazzi',
        'juice WRLD',
        'HOKO',
        'Ooyy',
        'oliver tree',
        'ekali',
        'denzel curry'
    ];
    await spoopipoo.dlMultArtistImg(artistsToGet);
})();
