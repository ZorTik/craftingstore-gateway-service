const {requireEnv} = require("./util");
const defaultLogger = {info: console.log, error: console.error, debug: console.debug};

function GatewayMediator(options) {
    validate(options, 'express');
    validate(options, 'registerServiceRouter');
    requireEnv("GATEWAY_SECRET_KEY");
    this.express = options.express;
    this.registerServiceRouter = options.registerServiceRouter;
    this.services = {};
    this.logger = options.logger || defaultLogger;
    Object.keys(options.services).forEach(key => {
        this.registerService(key, options.services[key]);
    });
}

GatewayMediator.prototype.registerService = function(serviceName, service) {
    this.logger.info(`Registering service ${serviceName}`);
    this.services[serviceName] = service;
    const router = this.express.Router();
    service.init(router, this.logger);
    this.registerServiceRouter(serviceName, router);
    this.logger.info(`${serviceName} registered`);
}

GatewayMediator.prototype.preprocessCSRequest = function(serviceName, request, response) {
    const statusBody = (status, msg) => {
        response.status(status).json({success: status === 200, status: status, message: msg});
        return msg;
    }

    if (!this.services[serviceName]) {
        return statusBody(404, `Service ${serviceName} not found.
        (Available: ${Object.keys(this.services).join(", ")})`);
    }

    this.logger.info(`Received request for service ${serviceName}`);

    const body = String(request.rawBody);
    const hmac = require('crypto').createHmac("sha256", process.env.GATEWAY_SECRET_KEY);
    hmac.update(body);
    const hash = hmac.digest('hex');

    this.logger.debug("Body: " + body);

    if (!request.headers['x-signature'] || request.headers['x-signature'] !== hash) {
        this.logger.error("Invalid signature: " + request.headers['x-signature'] + " vs " + hash);
        response.status(400).send(`{"success":false}`);
        return 'Unauthorized';
    }

    this.logger.debug(`Request for service ${serviceName} is valid`);

    return this.services[serviceName].handle;
}

function validate(obj, key) {
    if (!obj[key]) throw new Error(`Missing ${key} in object!`);
}

module.exports = GatewayMediator;
