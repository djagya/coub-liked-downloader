'use strict';

const EventEmitter = require('events');

class MyEmitter extends EventEmitter {
}

const myEmitter = new MyEmitter();

myEmitter.on('failed_redirect', () => {
    console.log('fail!!');
});

module.exports = myEmitter;
