var express = require('express');
var router = express.Router();
var passport = require('../lib/coub-strategy');
var request = require('request');
require('request-debug')(request);
//request.defaults({
//baseUrl: 'http://coub.com/api/v2/',
//});

router.get('/', function (req, res) {
    res.render('index');
});

router.route('/start')
    // page to start a download
    .get(function (req, res) {
        res.render('start');
    })

    // form with email and quality to start an async job
    .post(function (req, res, next) {
        // todo start async work
        // todo get email, quality

        request.get('/likes/by_channel', {
            baseUrl: 'http://coub.com/api/v2/',
            qs: {
                channel_id: req.user.channel_id,
                access_token: req.user.access_token
            },
            timeout: 1500
        }, function (error, response, body) {
            if (error) {
                console.log(error);
                res.render('error', {message: 'Error', error: error});
                return;
            }

            if (response.statusCode != 200) {
                console.log('Error: Status code ' + response.statusCode + ', body: ' + body);
                res.render('error', {message: body, error: {}});
                return;
            }

            res.send(response);
        });
    });

// get prepared archive
router.get('/download/:id', function (req, res) {
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
