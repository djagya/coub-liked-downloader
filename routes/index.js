'use strict';

var express = require('express');
var router = express.Router();
var passport = require('../lib/coub-strategy');
var _ = require('lodash');
var qualities = require('../helpers/qualityList');
var redis = require('redis'),
    client = redis.createClient(process.env.REDIS_URL, {});
var kue = require('kue'),
    queue = kue.createQueue({
        redis: process.env.REDIS_URL
    });
var coubsHelper = require('../helpers/coubs');
var fs = require('fs');
var filesize = require('filesize');
var archiver = require('archiver');

router.get('/', function (req, res) {
    res.render('index');
});

router.route('/start')
    .all(function (req, res, next) {
        if (!ensureUserData(req)) {
            res.redirect('/');
            return;
        }

        // if there is already a job with this channel_id - redirect to download page
        client.hget('job_channel_map', req.user.channel_id, function (err, result) {
            if (err) {
                console.log(err);
                res.render('error', {message: 'Error', error: err});
                return;
            }

            if (result) {
                res.redirect('/status/' + req.user.channel_id);
            } else {
                next();
            }
        });
    })

    // page to start a download
    .get(function (req, res) {
        res.render('start');
    })

    // form with email to start an async job
    .post(function (req, res) {
        // validation
        req.checkBody('email', 'Invalid email').notEmpty().withMessage('Email is required').isEmail();

        var errors = req.validationErrors();
        if (req.validationErrors()) {
            res.render('start', {errors: errors, post: req.body});
            return;
        }

        // job creation
        var job = queue.create('download_coubs', {
                title: 'Download liked coubs for channel #' + req.user.channel_id,
                channel_id: req.user.channel_id,
                access_token: req.user.access_token,
                email: req.body.email
            })
            .save(function (err) {
                if (err) {
                    console.log(err);
                    res.render('error', {message: 'Error', error: err});
                    return;
                }

                console.log('Job id:', job.id);

                // map job_id to channel_id
                client.hset('job_channel_map', req.user.channel_id, job.id, function (err, result) {
                    if (err) {
                        console.log(err);
                        res.render('error', {message: 'Error', error: err});
                        return;
                    }

                    //res.send('ok');
                    res.redirect('/success');
                });
            });
    });

// get prepared archive or show progress
router.get('/status/:id', function (req, res) {
    if (!ensureUserData(req)) {
        res.redirect('/');
        return;
    }

    // search job by channel_id
    client.hget('job_channel_map', req.params.id, function (err, result) {
        if (err) {
            console.log(err);
            res.render('error', {message: 'Error', error: err});
            return;
        }

        // todo show special error page if job is failed
        if (result) {
            // if there is a job - get its progress
            kue.Job.get(result, function (err, job) {
                if (err) {
                    console.log(err);
                    res.render('error', {message: 'Error', error: err});
                    return;
                }

                if (job._state === 'complete') {
                    coubsHelper.getCoubs(req.user.channel_id, req.user.access_token, function (err, data) {
                        // job is done
                        var links = _.map(qualities, function (label, val) {
                            var size = 0;

                            _.each(data, function (coub) {
                                try {
                                    size += fs.statSync(coubsHelper.getDestDoneFilename(coub, val)).size;
                                } catch (err) {
                                    console.log(err);
                                }
                            });

                            return {
                                label: label,
                                link: `/download/${req.params.id}?q=` + val,
                                size: filesize(size)
                            };
                        });

                        res.render('download', {data: links});
                    });
                } else {
                    // show progress bar
                    res.render('progress', {progress: job._progress || 0});
                }
            });
        } else {
            res.status(404).send('Not found');
        }
    });
});

// pipe done archive to the user
router.get('/download/:id', function (req, res) {
    if (!ensureUserData(req)) {
        res.redirect('/');
        return;
    }

    var quality = req.query.q || 'med',
        archive = archiver('zip');

    archive.on('error', function (err) {
        console.log(err);
    });

    // todo date, channel name
    // arhive name
    res.attachment(`liked_coubs_${req.user.channel_id}.zip`);

    // pipe to the response stream
    archive.pipe(res);

    coubsHelper.getCoubs(req.user.channel_id, req.user.access_token, function (err, data) {
        // todo exctract
        var size = 0;

        _.each(data, function (coub) {
            // todo exctract
            try {
                size += fs.statSync(coubsHelper.getDestDoneFilename(coub, quality)).size;
            } catch (err) {
                console.log(err);
            }

            var path = __dirname + '/../' + coubsHelper.getDestDoneFilename(coub, quality);

            if (fs.existsSync(path)) {
                archive.file(path, {name: coub.title + '.mp4'});
            }
        });

        res.set({
            'Content-Type': 'application/zip',
            'Content-Length': size
        });

        archive.finalize();
    });
});

router.get('/success', function (req, res) {
    res.render('success');
});

// coub auth stuff
router.get('/auth', passport.authenticate('provider', {scope: ['like', 'logged_in']}));

router.get('/callback', passport.authenticate('provider', {
    successRedirect: '/start',
    failureRedirect: '/'
}));

function ensureUserData(req) {
    //req.user = {
    //    channel_id: '620873',
    //    access_token: 'de8e4a792f2f0e15e1d81a0c6ef498e2c64b964f70fee068c5f2bdf466739f8d'
    //};

    // use lodash get, because req.user can be undefined too
    return _.has(req, 'user.access_token') && _.has(req, 'user.channel_id');
}

module.exports = router;
