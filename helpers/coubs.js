"use strict";

var redis = require('redis'),
    client = redis.createClient(process.env.REDIS_URL, {});
var async = require('async');
var request = require('request');
var _ = require('lodash');

const CACHE_DURATION = 3600;

/**
 * Fetch Coubs by channel id and create needed data array
 * @param channelId
 * @param accessToken
 * @param cb
 */
module.exports = {
    FOLDER_DONE: 'data/coubs',

    getCoubs: function (channelId, accessToken, cb) {
        var page = 1,
            totalPages = 1,
            coubsData = [],
            cacheKey = `coub_api_data:${channelId}`;

        console.log('Getting likes for %d channel', channelId);

        // check cache
        client.get(cacheKey, function (err, res) {
            if (res) {
                return cb(null, JSON.parse(res));
            }
        });

        // async loop to fetch liked coubs
        async.doWhilst(function (cb) {
            request.get('http://coub.com/api/v2/likes/by_channel', {
                qs: {
                    channel_id: channelId,
                    page: page,
                    access_token: accessToken
                },
                timeout: 10000
            }, function (error, response, body) {
                if (error) {
                    console.log(error);
                    return cb('API error');
                }

                if (response.statusCode !== 200) {
                    console.log('Error: Status code ' + response.statusCode + ', body: ' + body);
                    return cb('API error');
                }

                /** @see http://coub.com/dev/docs/Coub+API/Data+stuctures **/
                /**
                 * @var {{
             * coubs: [],
             * total_pages: int
             * }}
                 */
                var jsonResult = JSON.parse(body);

                /**
                 * @var {{
             * permalink: string,
             * file_versions: {web: {template: string, versions: []}},
             * audio_versions: {template: string, versions: []},
             * likes_count: int,
             * }} coub
                 */
                _.each(jsonResult.coubs, function (coub) {
                    var preparedData = {
                        id: coub.permalink,
                        title: coub.title,
                        video: coub.file_versions.web,
                        likesCount: coub.likes_count,
                        duration: coub.duration
                    };

                    // remove 'big' quality for video
                    _.remove(preparedData.video.versions, function (version) {
                        return version === 'big';
                    });

                    // if coub has audio (otherwise video by itself can have builtin audio)
                    if (Object.keys(coub.audio_versions).length) {
                        // remove not needed chunks property and get only mid version
                        preparedData.audio = {
                            template: coub.audio_versions.template,
                            version: coub.audio_versions.versions[1] || coub.audio_versions.versions[0]
                        };
                    }

                    coubsData.push(preparedData);
                });

                console.log('Page %d done', page);

                totalPages = jsonResult.total_pages;
                page++;

                // call callback to iterate further
                cb();
            });
        }, function () {
            return page < totalPages;
        }, function (err) {
            if (err) {
                cb(err);
            } else {
                client.setex(cacheKey, CACHE_DURATION, JSON.stringify(coubsData), function (err, res) {
                    cb(err, coubsData);
                });
            }
        });
    },

    getDestDoneFilename: function (coub, version) {
        return this.FOLDER_DONE + `/${coub.id}/${version}.mp4`;
    }
};
