var _ = require('lodash');
var async = require('async');
var request = require('request').defaults({
    baseUrl: 'http://coub.com/api/v2/'
});

var page = 1,
    totalPages = 1,
// contains: title, file_versions[web], audio_versions
    coubsData = [];

// async loop to fetch liked coubs
async.doWhilst(function (cb) {
    request.get('/likes/by_channel', {
        qs: {
            channel_id: req.user.channel_id,
            page: page,
            access_token: req.user.accessToken
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
        page++;

        // call callback to iterate further
        cb();
    });
}, function () {
    return page < totalPages;
}, function (err) {
    console.log(err);
});
