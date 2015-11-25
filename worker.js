var kue = require('kue'),
    queue = queue = kue.createQueue({
        redis: process.env.REDIS_URL
    });
var _ = require('lodash');
var async = require('async');
var request = require('request').defaults({
    baseUrl: 'http://coub.com/api/v2/'
});

// process queue
queue.process('download_coubs', 5, function (job, done) {
    getCoubs(job.data.channel_id, job.data.access_token, function (data) {
        processCoubs(job.data.quality, data, function () {
            sendEmail(job.data.email, done);
        });
    });

    function getCoubs(channelId, accessToken, cb) {
        var page = 1,
            totalPages = 1,
        // contains: title, file_versions[web], audio_versions
            coubsData = [];

        job.log('Getting likes for %d channel', channelId);

        // async loop to fetch liked coubs
        async.doWhilst(function (cb) {
            request.get('/likes/by_channel', {
                qs: {
                    channel_id: channelId,
                    page: page,
                    access_token: accessToken
                },
                timeout: 1500
            }, function (error, response, body) {
                if (error) {
                    console.log(error);
                    res.render('error', {message: 'Error', error: error});
                    cb('API error');
                }

                if (response.statusCode != 200) {
                    console.log('Error: Status code ' + response.statusCode + ', body: ' + body);
                    res.render('error', {message: body, error: {}});
                    cb('API error');
                }

                var jsonResult = JSON.parse(body);

                _.each(jsonResult.coubs, function (coub) {
                    coubsData.push({
                        id: coub.permalink,
                        title: coub.title,
                        video: coub.file_versions.web,
                        audio: coub.audio_versions
                    });
                });

                totalPages = jsonResult.total_pages;

                job.log('Page %d done', page);
                page++;

                // update job progress (make it so that when all coubs loaded = 10%, since processing is another 90%)
                job.progress(page * jsonResult.per_page, jsonResult.per_page * totalPages * 10);

                // call callback to iterate further
                cb();
            });
        }, function () {
            return page < totalPages;
        }, function (err) {
            console.log(err);

            cb(coubsData);
        });
    }

    function processCoubs(data, quality, cb) {
        job.log('Processing %d coubs with %s quality', data.length, quality);

        cb();
    }

    function sendEmail(to) {
        job.log('Sending email to %s', to);

        cb();
    }
});
