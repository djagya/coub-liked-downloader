'use strict';

/**
 * Dependencies
 */
const program = require('commander');
const opener = require('opener');
const path = require('path');
const pkg = require(path.join(__dirname, 'package.json'));
const emitter = require('./emitters/emitter');
const memoryCache = require('./helpers/memory-cache');
const CoubWorker = require('./helpers/coub-worker');

// vars
var savePath = './data';

// program
program
    .version(pkg.version)
    .option('-p, --path', 'save path')
    .option('-q, --quality <low|mid|high>', 'quality', /^(low|mid|high)$/, 'mid')
    .parse(process.argv);

// check input args
const quality = program.quality;
if (program.path) {
    savePath = program.path;
}

// webserver
console.log('Starting the webserver');
const server = require('./bin/www');

// spawn the browser with coub auth url
console.log('Opening browser');
// todo
//opener('http://localhost:7654/auth');

emitter.once('success_redirect', () => {
    let creds = memoryCache().get('user');
    //let worker = new CoubWorker(creds.channel_id, creds.access_token);
    let worker = new CoubWorker(620873, 'caee56754c194842a881397ad8388a943721c4472fb691d5a3d470d89c62512f');

    // Close the webserver
    server.close();

    worker.start((err) => {
        if (err) {
            console.log(`work is failed, error: ${err}`);
        } else {
            console.log('work is done');
        }
    });
});

emitter.emit('success_redirect');


// todo:
// check if ffmpg is installed
// verbose mode to show ffmpg output


