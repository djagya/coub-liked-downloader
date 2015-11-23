var passport = require('passport'),
    OAuth2Strategy = require('passport-oauth').OAuth2Strategy;

// todo extract this strategy to package
passport.use('provider', new OAuth2Strategy({
        authorizationURL: 'http://coub.com/oauth/authorize',
        tokenURL: 'http://coub.com/oauth/token',
        clientID: '2d83ce8b012e7a3c63cb27e9afb81493adf33d0a8be2aea7555316443239a354',
        clientSecret: '2d83ce8b012e7a3c63cb27e9afb81493adf33d0a8be2aea7555316443239a354',
        callbackURL: 'http://localhost:3000/coub'
    }, function (accessToken, refreshToken, profile, done) {
        console.log(token);
        console.log(tokenSecret);
        console.log(profile);
    }
));

module.exports = passport;
