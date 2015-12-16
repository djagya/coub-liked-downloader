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
var getCoubs = require('./helpers/getCoubs');

console.log('Worker started');

// todo
// не создавать архив, а стримить его из сделанных коубов без сохранения архива
// сохранять только done coubs (по тайтлу в папки версий), их и стримить

// todo сохранять только один тип для видео и использовать его везде (для сохраненных готовых кобов)

// process queue
queue.process('download_coubs', 5, function (job, done) {
    console.log('Processing job');

    // check if there is already an archive and it's not older than 1 day
    // todo check if it's not older than one day
    if (fs.existsSync(`data/channels/${job.data.channel_id}`)) {
        console.log('Channel %d already has an archive', job.data.channel_id);

        return sendEmail(job.data.email, 'https://coub-downloader.herokuapp.com/download/' + job.data.channel_id, done);
    }

    async.waterfall([
        function (cb) {
            var result = getCoubs(job.data.channel_id, job.data.access_token, cb);

            // update job progress (make it so that when all coubs loaded = 15%, since email sending = 5% and processing is another 80%)
            job.progress(10, 100);

            return result;
        },
        function (data, cb) {
            return processCoubs(data, cb);
        },
        function (cb) {
            // todo get url dynamically
            return sendEmail(job.data.email, 'https://coub-downloader.herokuapp.com/download/' + job.data.channel_id, cb);
        }
    ], function (err) {
        if (err) {
            console.log('Job failed: ' + err);
            return done(new Error(err));
        }

        done();
    });

    /**
     * @param data structure: {
     *  id: permalink,
     *  title: string,
     *  video: {
     *      template: string, // http://.../%{type}_%{version}_size_1443337522_%{version}.%{type}
     *      types: ['flv', 'mp4'],
     *      versions: ['med', 'small'],
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
                        var command = baseCommand.replace(/%\{version}/g, version) + getDestDoneFilename(coub, version);

                        console.log('Processing command ' + command);
                        exec(command, cb);
                    });
                });
                async.parallel(commands, function (err) {
                    console.log('Commands processed');

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

                    if (fs.existsSync(folder + '/' + version)) {
                        console.log('Cloub %s is already downloaded for version %s', coub.id, version);
                        return cb();
                    }

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
});
