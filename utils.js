module.exports = {
    isInt(value) {
        var x;
        if (isNaN(value)) {
            return false;
        }
        x = parseFloat(value);
        return (x | 0) === x;
    },
    isEmpty(obj) {
        for (var key in obj) {
            if (obj.hasOwnProperty(key))
                return false;
        }
        return true;
    },
    hhmmss(secs) {
        hours = Math.floor(secs / 3600);
        secs %= 3600;
        minutes = Math.floor(secs / 60);
        seconds = secs % 60;

        return {
            h: hours,
            m: minutes,
            s: seconds
        };
    },
    formatedTime(secs){
        let time = this.hhmmss(secs);
        return `${time.h}h:${time.m}m:${time.s.toFixed(2)}s`;
    },
    async wait(ms){
        return new Promise(resolve => setTimeout(resolve, ms));
    },
    map : (value, x1, y1, x2, y2) => (value - x1) * (y2 - x2) / (y1 - x1) + x2
}