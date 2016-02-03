#!/usr/bin/env node
'use strict';

var program = require('commander');

var opener = require('opener');
var path = require('path');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var passport = require('./lib/coub-strategy');
var pkg = require(path.join(__dirname, 'package.json'));

// vars
var savePath = './data';

// program
program
    .version(pkg.version)
    .option('-p, --path', 'save path')
    .option('-q, --quality <low|mid|high>', 'quality', /^(low|mid|high)$/, 'mid')
    .parse(process.argv);

var quality = program.quality;

if (program.path) {
    savePath = program.path;
}

// todo:
// get access token

// check if ffmpg is installed
// verbose mode to show ffmpg output


