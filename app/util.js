module.exports.requireEnv = function(key) {
    if (!process.env[key])
        throw new Error(`Missing ${key} in environment variables!`);
}
