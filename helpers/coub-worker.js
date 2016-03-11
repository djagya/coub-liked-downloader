'use strict';

/**
 * Dependencies
 */
const async = require('async');
const request = require('request');
const _ = require('lodash');
const fs = require('fs');
const exec = require('child_process').exec,
    execSync = require('child_process').execSync;

const FOLDER_DONE = 'data/coubs';
const FOLDER_SOURCES = 'data/sources';

module.exports = class CoubWorker {
    constructor(channelId, accessToken) {
        this.channel = channelId;
        this.token = accessToken;
    }

    start(cb) {
        console.log('starting the worker with channel = ' + this.channel + ' and token = ' + this.token);

        // check if there is already an archive and it's not older than 1 day
        async.waterfall([
            (cb) => {
                var result = this.getCoubs(cb);

                // fixme lines below shouldnt work, because cb is called above???? OR result will be null????

                console.log('Got coubs: ' + result);

                // todo update progress

                return result;
            },
            (data, cb) => {
                return this.processCoubs(data, cb);
            }
        ], (err) => {
            if (err) {
                console.log('Job failed: ' + err);
                return cb(err);
            }

            cb();
        });

    }

    getCoubs(cb) {
        let page = 1,
            totalPages = 1,
            coubsData = [];

        console.log('Getting likes for %d channel', this.channel);

        // async loop to fetch liked coubs
        async.doWhilst((cb) => {
            request.get('http://coub.com/api/v2/likes/by_channel', {
                qs: {
                    channel_id: this.channel,
                    page: page,
                    access_token: this.token
                },
                timeout: 10000
            }, (error, response, body) => {
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
                _.each(jsonResult.coubs, (coub) => {
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

                // call callback to iterate further
                cb();
            });
        }, () => {
            return page < 2;
        }, (err) => {
            if (err) {
                cb(err);
            } else {
                cb(coubsData);
            }
        });
    }

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
    processCoubs(data, cb) {
        console.log('Processing %d coubs', data.length);

        async.each(data, function (coub, cb) {
            return process(coub, cb);
        }, function (err) {
            cb(err);
        });
    }

    /**
     * Process one coub
     */
    process(coub, cb) {
        // ensure that coub doesn't exist yet
        if (this.isCoubProcessed(coub)) {
            console.log(`Coub ${coub.id} is already processed`);
            return cb();
        }

        var folder = FOLDER_SOURCES + `/${coub.id}`,
            doneFolder = FOLDER_DONE + `/${coub.id}`;

        try {
            fs.mkdirSync(folder);
        } catch (e) {
            console.log(e);
        }

        try {
            fs.mkdirSync(doneFolder);
        } catch (e) {
            console.log(e);
        }

        async.series([
            function (cb) {
                return this.downloadFiles(coub, folder, cb);
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
                        var command = baseCommand.replace(/%\{version}/g, version) + this.getDestDoneFilename(coub, version);

                        console.log('Processing command ' + command);
                        exec(command, cb);
                    });
                });
                async.parallelLimit(commands, 3, function (err) {
                    console.log('Commands processed');

                    // todo 15% + current progress + rest 5% for email

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

    downloadFiles(coub, folder, cb) {
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

                if (fs.existsSync(folder + '/audio')) {
                    console.log('Cloub audio %s is already downloaded', coub.id);
                    return cb();
                }

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

    isCoubProcessed(coub) {
        return fs.existsSync(FOLDER_DONE + '/' + coub.id);
    }


    static getDestDoneFilename(coub, version) {
        return `${FOLDER_DONE}/${coub.id}/${version}.mp4`;
    }

    getTotalSize() {
        // todo
        //coubsHelper.getCoubs(req.user.channel_id, req.user.access_token, function (err, data) {
        //    // todo exctract
        //    var size = 0;
        //
        //    _.each(data, function (coub) {
        //        // todo exctract
        //        try {
        //            size += fs.statSync(coubsHelper.getDestDoneFilename(coub, quality)).size;
        //        } catch (err) {
        //            console.log(err);
        //        }
        //
        //        var path = __dirname + '/../' + coubsHelper.getDestDoneFilename(coub, quality);
        //
        //        if (fs.existsSync(path)) {
        //            archive.file(path, {name: coub.title + '.mp4'});
        //        }
        //    });
        //
        //    res.set({
        //        'Content-Type': 'application/zip',
        //        'Content-Length': size
        //    });
        //
        //    archive.finalize();
        //});
    }
};
