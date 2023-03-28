module.exports.requireEnv = function(key) {
    if (!process.env[key])
        throw new Error(`Missing ${key} in environment variables!`);

    return process.env[key];
}

module.exports.digestBody = function(rawBody) {
    const hmac = require('crypto').createHmac("sha256", process.env.GATEWAY_SECRET_KEY);
    hmac.update(rawBody);
    return hmac.digest("hex");
}
