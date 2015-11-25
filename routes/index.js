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

router.get('/', function (req, res) {
    res.render('index');
});

router.route('/start')
    .all(function (req, res, next) {
        // use lodash get, because req.user can be undefined too
        if (!(_.has(req, 'user.access_token') && _.has(req, 'user.channel_id'))) {
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
                res.redirect('/download/' + req.user.channel_id);
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
            .on('failed', function () {
                // remove mapping for failed job
                client.hdel('job_channel_map', req.user.channel_id, function (err, result) {
                    if (err) {
                        console.log(err);
                    }
                });
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

                    res.redirect('/success');
                });
            });
    });

// get prepared archive or show progress
router.get('/download/:id', function (req, res) {
    // search job by channel_id
    client.hget('job_channel_map', req.params.id, function (err, result) {
        if (err) {
            console.log(err);
            res.render('error', {message: 'Error', error: err});
            return;
        }

        if (result) {
            // if there is a job - get its progress
            kue.Job.get(result, function (err, job) {
                if (err) {
                    console.log(err);
                    res.render('error', {message: 'Error', error: err});
                    return;
                }

                if (job._progress == 100) {
                    // job is done
                    var data = _.map(qualities, function (label, val) {
                        // todo
                        return {
                            label: label,
                            link: 'link' + val,
                            size: '15kb'
                        };
                    });
                    res.render('download', {data: data});
                } else {
                    // show progress bar
                    res.render('progress', {progress: job._progress || 0});
                }
            });
        } else {
            res.status(404).send('Not found');
        }
    });

    // show 3 buttons with different qualities and sizes
});

router.get('/success', function (req, res) {
    res.render('finish');
});

// coub auth stuff
router.get('/auth', passport.authenticate('provider', {scope: ['like', 'logged_in']}));

router.get('/callback', passport.authenticate('provider', {
    successRedirect: '/start',
    failureRedirect: '/'
}));

module.exports = router;
