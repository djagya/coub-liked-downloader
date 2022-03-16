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
const AUDIO_TO_VIDEO_Q = {
    low: 'small',
    mid: 'med',
    high: 'big'
};

module.exports = class CoubWorker {
    constructor(channelId, accessToken, quality, destFolder) {
        this.channel = channelId;
        this.token = accessToken;

        this.audioQuality = quality;
        this.videoQuality = AUDIO_TO_VIDEO_Q[quality];

        // todo make this work
        this.destFolder = destFolder;
    }

    start(cb) {
        console.log('starting the worker with channel = ' + this.channel + ' and token = ' + this.token);

        // check if there is already an archive and it's not older than 1 day
        this.getCoubs((err, data) => {
            this.processCoubs(data, cb);
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
                            versions: coub.audio_versions.versions
                        };
                    }

                    // check if coub is banned
                    if (!preparedData.video || preparedData.title === 'Banned coub') {
                        console.log(`Coub "${preparedData.id}" is banned and will not be downloaded`);
                    } else {
                        coubsData.push(preparedData);
                    }
                });

                console.log('Page %d done', page);

                totalPages = jsonResult.total_pages;
                page++;

                // call callback to iterate further
                cb();
            });
        }, () => {
            return page < totalPages;
        }, (err) => {
            if (err) {
                cb(err);
            } else {
                cb(null, coubsData);
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
     *      versions: ['big', 'med', 'small'],
     *  },
     *  audio: { // could be empty, http://.../%{version}_1438269759_fn9716_normalized_1438261874_audio.mp3
     *      template: string,
     *      versions: ['high', 'mid' 'low'],
     *  },
     *  likesCount: int,
     *  durationL int,
     * }
     * @param cb
     */
    processCoubs(data, cb) {
        console.log('Processing %d coubs', data.length);

        async.each(data, (coub, cb) => {
            this.process(coub, cb);
        }, (err) => {
            cb(err);
        });
    }

    /**
     * Process one coub
     */
    process(coub, cb) {
        // ensure that coub doesn't exist yet
        if (CoubWorker.isCoubProcessed(coub)) {
            console.log(`Coub ${coub.id} is already processed`);
            return cb();
        }

        let folder = FOLDER_SOURCES + `/${coub.id}`;

        try {
            fs.mkdirSync(folder);
        } catch (e) {
        }

        async.series([
            (cb) => {
                return this.downloadFiles(coub, folder, cb);
            },
            (cb) => {
                // concat video and audio (if any)
                let baseCommand = `cp ${folder}/video `;

                if (coub.audio) {
                    let audioDuration;

                    try {
                        // check audio duration
                        audioDuration =
                            execSync('ffprobe -i ' + folder + '/audio -show_entries format=duration -v quiet -of csv="p=0"').toString();
                    } catch (e) {
                        console.log('Error: ' + e);
                    }

                    // we use audio only if probe was successful
                    if (audioDuration) {
                        if (audioDuration > coub.duration) {
                            // audio is longer, prepare file for video repeat
                            let videoRepeatTimes = Math.round(audioDuration / coub.duration);

                            // prepare text file to repeat videos
                            _.each(coub.video.versions, function (version) {
                                for (let i = 0; i < videoRepeatTimes; i++) {
                                    fs.appendFileSync(`${folder}/repeat.txt`, "file 'video'\n");
                                }
                            });

                            baseCommand = `ffmpeg -f concat -i ${folder}/repeat.txt -i ${folder}/audio -c copy `;
                        } else {
                            baseCommand = `ffmpeg -i ${folder}/video -i ${folder}/audio -c copy `;
                        }
                    }
                }

                var command = baseCommand + CoubWorker.getDestDoneFilename(coub);

                console.log('Processing command ' + command);
                exec(command, cb);

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
        ], (err) => {
            cb(err);
        });
    }

    downloadFiles(coub, folder, cb) {
        // parallel download video and audio data
        async.parallel([
            (cb) => {
                // prefer mp4, otherwise select first
                let videoType = _.includes(coub.video.types, 'mp4') ? 'mp4' : coub.video.types[0],
                    videoUrl = coub.video.template
                        .replace(/%\{type}/g, videoType)
                        .replace(/%\{version}/g, this.videoQuality);

                // download video
                console.log(`Download video: ${videoUrl} for ${coub.id}`);

                try {
                    fs.accessSync(`${folder}/video`);
                    console.log(`Coub ${coub.id} video is already downloaded`);
                    return cb();
                } catch (e) {
                }

                request(videoUrl)
                    .on('end', () => {
                        console.log(`Item "${folder}/video" is downloaded`);
                        cb();
                    })
                    .on('error', (err) => {
                        cb(err);
                    })
                    .pipe(fs.createWriteStream(`${folder}/video`));
            },
            (cb) => {
                // download audio (use just one quality)
                if (!coub.audio) {
                    return cb();
                }

                let audioUrl = coub.audio.template.replace(/%\{version}/g, this.audioQuality);

                try {
                    fs.accessSync(`${folder}/audio`);
                    console.log(`Coub ${coub.id} audio is already downloaded`);
                    return cb();
                } catch (e) {
                }

                console.log(`Download audio: ${audioUrl} for ${coub.id}`);

                request(audioUrl)
                    .on('end', () => {
                        console.log(`Item "${folder}/audio" is downloaded`);
                        cb();
                    })
                    .on('error', (err) => {
                        cb(err);
                    })
                    .pipe(fs.createWriteStream(`${folder}/audio`));
            }
        ], (err) => {
            console.log(`Data ${folder} downloading is finished`);
            cb(err);
        });
    }

    static isCoubProcessed(coub) {
        try {
            fs.accessSync(CoubWorker.getDestDoneFilename(coub));

            return true;
        } catch (e) {
            return false;
        }
    }

    static getDestDoneFilename(coub) {
        return `${FOLDER_DONE}/${coub.id}.mp4`;
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
