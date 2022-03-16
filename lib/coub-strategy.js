var passport = require('passport'),
    OAuth2Strategy = require('passport-oauth').OAuth2Strategy,
    request = require('request');

// todo extract this strategy to package
passport.use('provider', new OAuth2Strategy({
        authorizationURL: 'http://coub.com/oauth/authorize',
        tokenURL: 'http://coub.com/oauth/token',
    clientID: 'd54dd5b7c72d3198bdcbcb9d9ff630c4c0a5b537133076e659d98b293286f036',
    clientSecret: '388cbb62bbd6394b79fe36fc6535f533459a4adb98d55233555c30a805e02fb8',
    callbackURL: 'http://localhost:7654/'
    }, function (accessToken, refreshToken, profile, done) {
        // save the token to session
        profile.access_token = accessToken;

        request.get('http://coub.com/api/v2/users/me?access_token=' + accessToken, {timeout: 1500}, function (error, response, body) {
            if (error) {
                console.log(error);
                return done(error);
            }

            if (response.statusCode !== 200) {
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
