var express = require('express');
var router = express.Router();
var passport = require('../lib/coub-strategy');

/* GET home page. */
router.get('/', function (req, res, next) {
    res.render('index', {title: 'Express'});
});

router.get('/auth', passport.authenticate('provider', {scope: ['like', 'logged_in']}));

router.get('/coub', passport.authenticate('provider', {
    successRedirect: '/',
    failureRedirect: '/'
}));

module.exports = router;
