var express = require('express');
var router = express.Router();
var passport = require('../lib/coub-strategy');
var kue = require('kue'),
    queue = kue.createQueue({
        redis: process.env.REDIS_URL
    });

router.get('/', function (req, res) {
    res.render('index');
});

router.route('/start')
    .all(function (req, res, next) {
        if (!req.user.access_token || !req.user.channel_id) {
            res.redirect('/');
            return;
        }

        next();
    })

    // page to start a download
    .get(function (req, res) {
        res.render('start');
    })

    // form with email and quality to start an async job
    .post(function (req, res) {
        if (!req.session.jobId && !req.params.force) {
            res.redirect('/success');
            return;
        }

        var job = queue.create('download_coubs', {
                title: 'Download liked for channel #' + req.user.channel_id,
                channel_id: req.user.channel_id,
                access_token: req.user.access_token,
                email: req.body.email,
                quality: req.body.quality
            })
            .removeOnComplete(true)
            .save(function (err) {
                if (err) {
                    console.log(err);
                    res.render('error', {message: 'Error', error: err});
                    return;
                }

                req.session.jobId = job.id;

                console.log('Job id:', job.id);
                res.redirect('/success');
            });
    });

// get prepared archive or show progress
router.get('/download/:id', function (req, res) {
    kue.Job.get(req.params.id, function (err, job) {
        res.send(job);
    });
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
