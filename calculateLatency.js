let latency = require('./RDJ.postman_test_run.json');

let testObj={};
let i;
for(const test of latency.results){
    testObj[test.name] = 0; 
    i = 0;
    for(const time of test.times){
        testObj[test.name] += time;
        i++;
    }
    testObj[test.name]/=i;  
    testObj[test.name] = testObj[test.name] + ' ms';
}

console.log(JSON.stringify(testObj));