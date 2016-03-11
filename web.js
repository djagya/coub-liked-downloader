'use strict';

/**
 * Dependencies
 */
const express = require('express');
const passport = require('./lib/coub-strategy');
const memoryCache = require('./helpers/memory-cache');
const emitter = require('./emitters/emitter');

// start webserver
const app = express();

app.use(passport.initialize());
app.get('/auth', passport.authenticate('provider', {scope: ['like', 'logged_in'], session: false}));
app.get('/', passport.authenticate('provider', {session: false}), function (req, res) {
    // close connection
    req.connection.unref();

    memoryCache().set('user', req.user);

    emitter.emit('success_redirect');

    res.send('<script>window.close()</script>');
});

// catch 404 and forward to error handler
app.use(function (req, res, next) {
    var err = new Error('Not Found');
    err.status = 404;
    next(err);
});

// error handlers
app.use(function (err, req, res, next) {
    res.status(err.status || 500);
    res.json({
        message: err.message,
        error: {}
    });
});

module.exports = app;
