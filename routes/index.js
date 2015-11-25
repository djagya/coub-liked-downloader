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
        if (req.session.jobId) {
            res.render('finish');
            return;
        }

        var job = queue.create('download_coubs', {
                title: 'Download liked for channel #' + req.user.channel_id,
                channel_id: req.user.channel_id,
                access_token: req.user.access_token,
                email: req.params.email,
                quality: req.params.quality
            })
            .removeOnComplete(true)
            .save(function (err) {
                if (err) {
                    console.log(err);
                    res.render('error', {message: 'Error', error: err});
                    return;
                }

                req.session.jobId = job.id;

                console.log(job.id);
                res.render('finish');
            });
    });

// get prepared archive
router.get('/download/:id', function (req, res) {
    // use job.progress(frames, totalFrames); to show progress

    // check files if there is an archive with that id
    // req.params.id

    res.send({file: 'download'});
});

router.get('/success', function (req, res) {
    // todo make a request
    // go through coubs
    // download to a folder
    // each should have name


    // todo: do not download files, use remote file urls for ffmpeg and ffprobe
    // how to download:
    // 1. get video
    // 2. get audion
    // 3. check audio (with ffprobe: ffprobe -i input.mp4 -show_entries format=duration -v quiet -of csv="p=0") and video duarations
    // 4. if audio > video: ffmpeg -f concat -i list.txt -i input.mp3 -c copy output.mp4 , where list.txt is the repeated video names like "file 'input.mp4'" on each line n times, where n = audio_duration/video_duration
    res.json({
        message: 'success',
        session: JSON.stringify(req.session),
        user: JSON.stringify(req.user || {})
    });
});

router.get('/auth', passport.authenticate('provider', {scope: ['like', 'logged_in']}));

router.get('/callback', passport.authenticate('provider', {
    successRedirect: '/start',
    failureRedirect: '/'
}));

module.exports = router;
