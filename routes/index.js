var express = require('express');
var router = express.Router();
var passport = require('../lib/coub-strategy');
var _ = require('lodash');
var async = require('async');
var request = require('request').defaults({
    baseUrl: 'http://coub.com/api/v2/'
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
    .post(function (req, res, next) {
        // todo start async work
        // todo get email, quality

        var page = 1,
            totalPages = 1,
        // contains: title, file_versions[web], audio_versions
            coubsData = [];

        // async loop to fetch liked coubs
        //async.doWhilst(function (cb) {
        //    request.get('/likes/by_channel', {
        //        qs: {
        //            channel_id: req.user.channel_id,
        //            page: page,
        //            access_token: req.user.accessToken
        //        },
        //        timeout: 1500
        //    }, function (error, response, body) {
        //        if (error) {
        //            console.log(error);
        //            res.render('error', {message: 'Error', error: error});
        //            cb('API error');
        //        }
        //
        //        if (response.statusCode != 200) {
        //            console.log('Error: Status code ' + response.statusCode + ', body: ' + body);
        //            res.render('error', {message: body, error: {}});
        //            cb('API error');
        //        }
        //
        //        var jsonResult = JSON.parse(body);
        //
        //        _.each(jsonResult.coubs, function (coub) {
        //            coubsData.push({
        //                id: coub.permalink,
        //                title: coub.title,
        //                video: coub.file_versions.web,
        //                audio: coub.audio_versions
        //            });
        //        });
        //
        //        totalPages = jsonResult.total_pages;
        //        page++;
        //
        //        // call callback to iterate further
        //        cb();
        //    });
        //}, function () {
        //    return page < totalPages;
        //}, function (err) {
        //    console.log(err);
        //    res.render('info', {data: coubsData});
        //});

        res.render('success');
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
