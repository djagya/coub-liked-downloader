var passport = require('passport'),
    OAuth2Strategy = require('passport-oauth').OAuth2Strategy,
    request = require('request');

// todo extract this strategy to package
passport.use('provider', new OAuth2Strategy({
        authorizationURL: 'http://coub.com/oauth/authorize',
        tokenURL: 'http://coub.com/oauth/token',
        clientID: '2d83ce8b012e7a3c63cb27e9afb81493adf33d0a8be2aea7555316443239a354',
        clientSecret: 'd47a742b05ab3bd3ef5e9b462e7d97e601840acf4c4224b7a64c0ef74b3f6bde',
        callbackURL: 'https://coub-downloader.herokuapp.com/callback'
    }, function (accessToken, refreshToken, profile, done) {
        // save the token to session
        profile.accessToken = accessToken;

        request.get('http://coub.com/api/v2/users/me?access_token=' + accessToken, {timeout: 1500}, function (error, response, body) {
            if (error) {
                console.log(error);
                return done(error);
            }

            if (response.statusCode != 200) {
                console.log('Error: Status code ' + response.statusCode + ', body: ' + body);
                return done('Error: Status code ' + response.statusCode);
            }

            var userInfo = JSON.parse(body);
            profile.channel_id = userInfo.current_channel.id;

            return done(null, profile);
        });
    }
));

passport.serializeUser(function (user, done) {
    done(null, user);
});

passport.deserializeUser(function (user, done) {
    done(null, user);
});

module.exports = passport;
