'use strict';

const POPULAR_COUB_LIKES_COUNT = 1000;
const FOLDER_SOURCES = 'data/sources';
const FOLDER_DONE = 'data/coubs';

var kue = require('kue'),
    queue = kue.createQueue({
        redis: process.env.REDIS_URL
    });
var _ = require('lodash');
var async = require('async');
var nodemailer = require('nodemailer');
var fs = require('fs');
var exec = require('child_process').exec,
    execSync = require('child_process').execSync;
var request = require('request');
var rmdir = require('rimraf');
var archiver = require('archiver');

console.log('Worker started');

// process queue
queue.process('download_coubs', 5, function (job, done) {
    console.log('Processing job');

    // check if there is already an archive and it's not older than 1 day
    // todo check if it's not older than one day
    if (fs.existsSync(getArchiveFilename())) {
        console.log('Channel %d already has an archive', job.data.channel_id);
        return done();
    }

    async.waterfall([
        function (cb) {
            return getCoubs(job.data.channel_id, job.data.access_token, cb);
        },
        function (data, cb) {
            return processCoubs(data, cb);
        },
        function (data, cb) {
            return archive(data, cb);
        },
        function (cb) {
            // todo get url dynamically
            return sendEmail(job.data.email, 'https://coub-downloader.herokuapp.com/download/' + job.data.channel_id, cb);
        }
    ], function (err) {
        if (err) {
            return done(new Error(err));
        }

        done();
    });

    /**
     * Fetch Coubs by channel id and create needed data array
     * @param channelId
     * @param accessToken
     * @param cb
     */
    function getCoubs(channelId, accessToken, cb) {
        var page = 1,
            totalPages = 1,
            coubsData = [];

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

                if (response.statusCode !== 200) {
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

                console.log('Page %d done', page);

                totalPages = jsonResult.total_pages;
                page++;

                // update job progress (make it so that when all coubs loaded = 15%, since email sending = 5% and processing is another 80%)
                job.progress(page * jsonResult.per_page, (jsonResult.per_page * totalPages * 100) / 15);

                // call callback to iterate further
                cb();
            });
        }, function () {
            //return page < 1;
            return page < totalPages;
        }, function (err) {
            cb(err, coubsData);
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
        console.log('Processing %d coubs', data.length);

        async.each(data, function (coub, cb) {
            return process(coub, cb);
        }, function (err) {
            cb(err, data);
        });
    }

    /**
     * Process one coub
     */
    function process(coub, cb) {
        // ensure that coub doesn't exist yet
        if (isCoubProcessed(coub)) {
            console.log(`Coub ${coub.id} is already processed`);
            return cb();
        }

        var folder = FOLDER_SOURCES + `/${coub.id}`,
            doneFolder = FOLDER_DONE + `/${coub.id}`;

        // create folders, in case of error - skip coub, it means it was processed already
        try {
            fs.mkdirSync(folder);
            fs.mkdirSync(doneFolder);
        } catch (e) {
            console.log(e);
            return cb();
        }

        async.series([
            function (cb) {
                return downloadFiles(coub, folder, cb);
            },
            function (cb) {
                // concat video and audio (if any)
                let baseCommand;

                if (coub.audio) {
                    // check audio duration
                    let audioDuaration =
                        execSync('ffprobe -i ' + folder + '/audio -show_entries format=duration -v quiet -of csv="p=0"').toString();

                    if (audioDuaration > coub.duration) {
                        // audio is longer, prepare file for video repeat
                        let videoRepeatTimes = Math.round(audioDuaration / coub.duration);

                        // prepare text file to repeat videos
                        _.each(coub.video.versions, function (version) {
                            for (let i = 0; i < videoRepeatTimes; i++) {
                                fs.appendFileSync(`${folder}/${version}.txt`, `file '${version}'\n`);
                            }
                        });

                        baseCommand = `ffmpeg -f concat -i ${folder}/%{version}.txt -i ${folder}/audio -c copy `;
                    } else {
                        baseCommand = `ffmpeg -i ${folder}/%{version} -i ${folder}/audio -c copy `;
                    }
                } else {
                    baseCommand = `ffmpeg -i ${folder}/%{version} -c copy `;
                }

                // create and execute commands
                var commands = [];
                _.each(coub.video.versions, function (version) {
                    commands.push(function (cb) {
                        console.log('Processing command ' + baseCommand);
                        exec(baseCommand.replace(/%\{version}/g, version) + getDestDoneFilename(coub, version), cb);
                    });
                });
                async.parallel(commands, function (err) {
                    // todo 15% + current progress + rest 5% for email
                    job.progress(80, 100);

                    cb(err);
                });

                // clear things
                //if (process.env.ENV === 'production') {
                //    // clear sources
                //    // todo delete sources (but what if someone do the same coub?)
                //    rmdir(folder, function (err) {
                //        console.log(err);
                //    });
                //
                //    // delete not popular coubs after processing to save disk space
                //    // todo rethink it
                //    //if (coub.likesCount < POPULAR_COUB_LIKES_COUNT) {
                //    //    rmdir(doneFolder, function (err) {
                //    //        console.log(err);
                //    //    });
                //    //}
                //}

            }
        ], function (err) {
            cb(err);
        });
    }

    /**
     * Create an archive for each version
     * @param data
     * @param cb
     */
    function archive(data, cb) {
        _.each(['big', 'med', 'small'], function (version) {
            var archive = archiver.create('zip', {});

            _.each(data, function (coub) {
                archive.file(getDestDoneFilename(coub, version), {name: coub.title + '.mp4'});
            });

            archive.finalize();
        });

        // todo call cb on finish all archives
        cb();
    }

    /**
     * Send notification that it's done
     * @param to
     * @param link
     * @param cb
     */
    function sendEmail(to, link, cb) {
        console.log('Sending email to %s', to);
        job.progress(90, 100);

        var transporter = nodemailer.createTransport({
                service: 'Gmail',
                auth: {
                    user: 'danil.kabluk@gmail.com',
                    pass: '8K736MA8Y5N'
                }
            }),
            mailOptions = {
                from: 'Coub downloader',
                to: to, // list of receivers
                subject: 'Your archive is ready!',
                html: '<a href="' + link + '">Link</a>'
            };

        transporter.sendMail(mailOptions, function (err, info) {
            if (!err) {
                console.log('Message sent: ' + info.response);
            }

            cb(err);
        });
    }

    function downloadFiles(coub, folder, cb) {
        // prefer mp4, otherwise select first
        var videoType = _.includes(coub.video.types, 'mp4') ? 'mp4' : coub.video.types[0],
            videoUrl = coub.video.template.replace(/%\{type}/g, videoType);

        // parallel download video and audio data
        async.parallel([
            function (cb) {
                // download video with each version
                async.each(coub.video.versions, function (version, cb) {
                    let url = videoUrl.replace(/%\{version}/g, version);
                    console.log("Download video: " + url);

                    request(url)
                        .on('end', function () {
                            console.log('Item is downloaded');
                            cb();
                        })
                        .on('error', function (err) {
                            cb(err);
                        })
                        .pipe(fs.createWriteStream(folder + '/' + version));
                }, function (err) {
                    cb(err);
                });
            },
            function (cb) {
                // download audio (use just one quality)
                if (!coub.audio) {
                    return cb();
                }

                let url = coub.audio.template.replace(/%\{version}/g, coub.audio.version);
                console.log("Download audio: " + url);

                request(url)
                    .on('end', function () {
                        console.log('Item is downloaded');
                        cb();
                    })
                    .on('error', function (err) {
                        cb(err);
                    })
                    .pipe(fs.createWriteStream(folder + '/audio'));
            }
        ], function (err) {
            console.log('Data downloading is finished');
            cb(err);
        });
    }

    function getDestDoneFilename(coub, version) {
        return FOLDER_DONE + `/${coub.id}/${version}.mp4`;
    }

    function isCoubProcessed(coub) {
        return fs.existsSync(FOLDER_DONE + '/' + coub.id);
    }

    function getArchiveFilename() {
        return `data/channels/${job.data.channel_id}.zip`;
    }
});
