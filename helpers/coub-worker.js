'use strict';

/**
 * Dependencies
 */


module.exports = class CoubWorker {
    constructor(channelId, accessToken) {
        this.channel = channelId;
        this.token = accessToken;
    }

    start(cb) {
        console.log('starting the worker with channel = ' + this.channel + ' and token = ' + this.token);

        return cb();
    }
};
