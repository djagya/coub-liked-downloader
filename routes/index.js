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
        if (!req.user.accessToken || !req.user.channel_id) {
            res.redirect('/');
        }

        next();
    })

    // page to start a download
    .get(function (req, res) {
        res.render('start');
    })

    // form with email and quality to start an async job
    .post(function (req, res) {
        if (!req.params.force) {
            res.render('finish');

        }

        //var job = queue.create('download_coubs', {
        //        title: 'Download liked for channel #' + req.user.channel_id,
        //        channel_id: req.user.channel_id,
        //        access_token: req.user.access_token,
        //        email: req.params.email,
        //        quality: req.params.quality
        //    })
        //    .removeOnComplete(true)
        //    .save(function (err) {
        //        if (err) {
        //            console.log(err);
        //            res.render('error', {message: 'Error', error: err});
        //            return;
        //        }
        //
        //        req.session.jobId = job.id;
        //
        //        console.log(job.id);
        //        res.render('finish');
        //    });
    });

// get prepared archive
router.get('/download/:id', function (req, res) {
    // use job.progress(frames, totalFrames); to show progress

    // check files if there is an archive with that id
    // req.params.id

    res.send({file: 'download'});
});

router.get('/success', function (req, res) {
    res.json({
        message: 'success',
        session: JSON.stringify(req.session),
        user: JSON.stringify(req.user || {})
    });
});

// coub auth stuff
router.get('/auth', passport.authenticate('provider', {scope: ['like', 'logged_in']}));

router.get('/callback', passport.authenticate('provider', {
    successRedirect: '/start',
    failureRedirect: '/'
}));

module.exports = router;
