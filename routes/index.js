var express = require('express');
var router = express.Router();
var passport = require('../lib/coub-strategy');

/* GET home page. */
router.get('/', function (req, res, next) {
    res.render('index', {title: 'Express'});
});

router.get('/success', function (req, res, next) {
    res.json({
        message: 'success',
        session: JSON.stringify(req.session),
        user: JSON.stringify(req.user || {})
    });
});

router.get('/auth', passport.authenticate('provider', {scope: ['like', 'logged_in']}));

router.get('/coub', passport.authenticate('provider', {
    successRedirect: '/success',
    failureRedirect: '/'
}));

module.exports = router;
