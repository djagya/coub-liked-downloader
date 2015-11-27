'use strict';

var kue = require('kue'),
    queue = queue = kue.createQueue({
        redis: process.env.REDIS_URL
    });
var _ = require('lodash');
var async = require('async');
var nodemailer = require('nodemailer');
var fs = require('fs');
var execSync = require('child_process').execSync;
var request = require('request');

const POPULAR_COUB_LIKES_COUNT = 1000;

console.log('Worker started');

// process queue
queue.process('download_coubs', 5, function (job, done) {
    // todo check if there is already an archive and it's not older than 1 day
    console.log('Processing job');

    getCoubs(job.data.channel_id, job.data.access_token, function (data) {
        processCoubs(data, function () {
            // todo get url dynamically
            sendEmail(job.data.email, 'https://coub-downloader.herokuapp.com/download/' + job.data.channel_id, done);
        });
    });

    function getCoubs(channelId, accessToken, cb) {
        var page = 1,
            totalPages = 1,
            coubsData = [];

        job.log('Getting likes for %d channel', channelId);
        console.log('Getting likes for %d channel', channelId);

        // async loop to fetch liked coubs
        async.doWhilst(function (cb) {
            request.get('http://coub.com/api/v2/likes/by_channel', {
                qs: {
                    channel_id: channelId,
                    page: page,
                    access_token: accessToken
                },
                timeout: 3000
            }, function (error, response, body) {
                if (error) {
                    console.log(error);
                    cb('API error');
                }

                if (response.statusCode != 200) {
                    console.log('Error: Status code ' + response.statusCode + ', body: ' + body);
                    cb('API error');
                }

                /** @see http://coub.com/dev/docs/Coub+API/Data+stuctures **/
                var jsonResult = JSON.parse(body);

                _.each(jsonResult.coubs, function (coub) {
                    var preparedData = {
                        id: coub.permalink,
                        title: coub.title,
                        video: coub.file_versions.web,
                        likesCount: coub.likes_count,
                        duration: coub.duration
                    };

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

                job.log('Page %d done', page);
                console.log('Page %d done', page);

                totalPages = jsonResult.total_pages;
                page++;

                // update job progress (make it so that when all coubs loaded = 15%, since email sending = 5% and processing is another 80%)
                job.progress(page * jsonResult.per_page, (jsonResult.per_page * totalPages * 100) / 15);

                // call callback to iterate further
                cb();
            });
        }, function () {
            return page < totalPages;
        }, function (err) {
            if (err) {
                console.log(err);
                throw new Error(err);
            }

            cb(coubsData);
        });
    }

    /**
     * @param data structure: {
     *  id: permalink,
     *  title: string,
     *  video: {
     *      template: string, // http://.../%{type}_%{version}_size_1443337522_%{version}.%{type}
     *      types: ['flv', 'mp4'],
     *      versions: ['big', 'med', 'small'],
     *  },
     *  audio: { // could be empty, http://.../%{version}_1438269759_fn9716_normalized_1438261874_audio.mp3
     *      template: string,
     *      version: 'mid',
     *  },
     *  likesCount: int,
     *  durationL int,
     * }
     * @param cb
     */
    function processCoubs(data, cb) {
        job.log('Processing %d coubs', data.length);
        console.log('Processing %d coubs', data.length);
        var request = require('request');

        _.each(data, function (coub, k) {
            var folder = `data/coubs/${coub.id}`;
            // create folder
            try {
                fs.mkdirSync(folder);
            } catch (e) {
            }

            // prefer mp4, otherwise select first
            var videoType = _.includes(coub.video.types, 'mp4') ? 'mp4' : coub.video.types[0],
                videoUrl = coub.video.template.replace(/%\{type}/g, videoType);

            // download video with each version
            _.each(coub.video.versions, function (version) {
                let url = videoUrl.replace(/%\{version}/g, version);
                console.log("Download video: " + url);

                request(url).pipe(fs.createWriteStream('test.mp4'));
            });

            // download audio (use just one quality)
            if (coub.audio) {
                let url = coub.audio.template.replace(/%\{version}/g, coub.audio.version);
                console.log("Download audio: " + url);

                request(url).pipe(fs.createWriteStream(folder + '/audio'));
            }


            // concat video and audio (if any)
            let commands = [];
            if (coub.audio) {
                // check audio duration
                let audioDuaration =
                    execSync('ffprobe -i ' + folder + '/audio -show_entries format=duration -v quiet -of csv="p=0"').toString();
                if (audioDuaration > coub.duration) {
                    // audio is longer, prepare file for video repeat
                    let videoRepeatTimes = Math.round(audioDuaration / coub.duration);

                    _.each(coub.video.versions, function (version) {
                        for (let i = 0; i < videoRepeatTimes; i++) {
                            fs.appendFileSync(`${folder}/${version}.txt`, `file '${version}'`);
                        }

                        commands.push(`ffmpeg -f concat -i ${folder}/${version}.txt -i ${folder}/audio -c copy ${folder}/done.mp4`);
                    });
                } else {
                    _.each(coub.video.versions, function (version) {
                        commands.push(`ffmpeg -i ${folder}/${version} -i ${folder}/audio -c copy ${folder}/done.mp4`);
                    });
                }
            } else {
                _.each(coub.video.versions, function (version) {
                    commands.push(`ffmpeg -i ${folder}/${version} -c copy ${folder}/done.mp4`);
                });
            }

            // execute commands
            _.each(commands, function (item) {
                console.log(execSync(item).toString());
            });


            // clear not popular coubs after processing to save disk space
            if (app.get('env') === 'production' && coub.likesCount < POPULAR_COUB_LIKES_COUNT) {
                _.each(coub.video.versions, function (version) {
                    fs.unlink(folder + version, () => {
                    });
                });

                fs.unlink(folder + 'audio', () => {
                })
            }

            // todo 15% + current progress + rest 5% for email
            job.progress(k, data.length);
        });

        // todo archive done videos
        _.each(data, function (coub) {

        });

        cb();
    }

    function sendEmail(to, link, cb) {
        job.log('Sending email to %s', to);
        console.log('Sending email to %s', to);
        job.progress(90, 100);

        var transporter = nodemailer.createTransport({
            service: 'Gmail',
            auth: {
                user: 'danil.kabluk@gmail.com',
                pass: '8K736MA8Y5N'
            }
        });

        var mailOptions = {
            from: 'Coub downloader',
            to: to, // list of receivers
            subject: 'Your archive is ready!',
            html: '<a href="' + link + '">Link</a>'
        };

        transporter.sendMail(mailOptions, function (error, info) {
            if (error) {
                console.log(error);
                // todo fail the job
            } else {
                console.log('Message sent: ' + info.response);
            }

            cb();
        });
    }
});
