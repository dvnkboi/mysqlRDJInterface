const Model = require('./model');
const bent = require('bent');

class Poster{

    constructor(){
        this.model = new Model('clients','nosql');
        this.post = bent('POST', 'json', 200);
    }

    async sendPost(){
        let result;
        try{
            result = await this.post('https://api.ampupradio.com:3000/',{
                name:'bruh',
                bruh:'bro'
            });
            console.log(result);
        }
        catch(e){
            console.log(result);
            console.log('oof',e);
        }
    }
}

(async () => {
    const poster = new Poster();
    await poster.sendPost();
})();

module.exports = Poster;