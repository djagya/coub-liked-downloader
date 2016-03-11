'use strict';

var cache = {};

module.exports = function () {
    return {
        get: function (key) {
            return cache[key];
        },
        set: function (key, val) {
            cache[key] = val;
        }
    };
};
