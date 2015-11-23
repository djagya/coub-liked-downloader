var passport = require('passport'),
    OAuth2Strategy = require('passport-oauth').OAuth2Strategy;


// todo extract this strategy to package
passport.use('provider', new OAuth2Strategy({
        authorizationURL: 'http://coub.com/oauth/authorize',
        tokenURL: 'http://coub.com/oauth/token',
        clientID: '2d83ce8b012e7a3c63cb27e9afb81493adf33d0a8be2aea7555316443239a354',
        clientSecret: 'd47a742b05ab3bd3ef5e9b462e7d97e601840acf4c4224b7a64c0ef74b3f6bde',
        callbackURL: 'https://coub-downloader.herokuapp.com/coub'
    }, function (accessToken, refreshToken, profile, done) {
        profile.accessToken = accessToken;
        return done(null, profile);
    }
));

passport.serializeUser(function (user, done) {
    done(null, user);
});

passport.deserializeUser(function (user, done) {
    done(null, user);
});

module.exports = passport;
